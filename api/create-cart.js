import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const MAX_TICKETS_PER_ORDER = 10;
const CART_SECONDS = 15 * 60;

const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

const SEAT_ZONES = {
  mainHall: "Main Hall",
  watchParty: "Watch Party",
};


/* =========================================
   GET PRETIX SEATS
   ========================================= */

async function getPretixSeats(zoneName) {

  const response = await fetch(
    `${PRETIX_BASE}/seats/?zone_name=${encodeURIComponent(zoneName)}`,
    {
      headers: {
        Authorization:
          `Token ${process.env.PRETIX_API_TOKEN}`,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      `Could not load ${zoneName} seats from Pretix.`
    );
  }

  return data.results || [];
}


/* =========================================
   FIND REAL PRETIX SEAT
   ========================================= */

function findPretixSeat(
  temporarySeatId,
  pretixSeats
) {

  const parts =
    temporarySeatId.split("-");

  if (parts.length !== 3) {
    return null;
  }

  const venue =
    parts[0];

  const rowLetter =
    parts[1];

  const seatNumber =
    parts[2];

  if (
    !["mainHall", "watchParty"]
      .includes(venue)
  ) {
    return null;
  }

  const numericRow =
    String(
      rowLetter.charCodeAt(0) - 64
    );

  return (
    pretixSeats.find(seat => {

      const sameSeat =
        String(seat.seat_number) ===
        String(seatNumber);

      const sameNumericRow =
        String(seat.row_name) ===
        numericRow;

      const sameLetterRow =
        String(seat.row_name)
          .toUpperCase() ===
        rowLetter.toUpperCase();

      return (
        sameSeat &&
        (sameNumericRow || sameLetterRow) &&
        !seat.blocked &&
        !seat.orderposition &&
        !seat.cartposition &&
        !seat.voucher
      );

    }) || null
  );
}


/* =========================================
   MAIN HANDLER
   ========================================= */

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  try {

    const body = req.body;

    if (
      !body ||
      typeof body !== "object"
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid request body.",
      });
    }

    const {
      checkoutId,
      seats
    } = body;


    /* =====================================
       VALIDATE CHECKOUT ID
       ===================================== */

    if (
      typeof checkoutId !== "string" ||
      checkoutId.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "checkoutId is required.",
      });
    }


    /* =====================================
       VALIDATE SEATS
       ===================================== */

    if (
      !Array.isArray(seats) ||
      seats.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "seats must be a non-empty array.",
      });
    }

    if (
      seats.length >
      MAX_TICKETS_PER_ORDER
    ) {
      return res.status(400).json({
        success: false,
        error:
          `Maximum ${MAX_TICKETS_PER_ORDER} tickets per order.`,
      });
    }


    /* =====================================
       LOAD CHECKOUT
       ===================================== */

    const checkoutKey =
      `tedx:checkout:${checkoutId}`;

    const checkout =
      await redis.get(checkoutKey);

    if (!checkout) {
      return res.status(400).json({
        success: false,
        error:
          "This checkout has expired or could not be found. Please start again.",
      });
    }

    if (
      !Array.isArray(checkout.tickets) ||
      checkout.tickets.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid checkout reservation.",
      });
    }

    const reservedTickets =
      checkout.tickets;

    if (
      reservedTickets.length !==
      seats.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The number of selected seats does not match the number of tickets.",
      });
    }


    /* =====================================
       CLEAN SEATS
       ===================================== */

    const cleanedSeats =
      seats.map(seat => {

        if (
          typeof seat !== "string" ||
          seat.trim() === ""
        ) {
          return null;
        }

        return seat.trim();

      });

    if (
      cleanedSeats.some(
        seat => seat === null
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Every ticket must have a valid seat.",
      });
    }


    /* =====================================
       CHECK DUPLICATES
       ===================================== */

    const uniqueSeats =
      new Set(cleanedSeats);

    if (
      uniqueSeats.size !==
      cleanedSeats.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The same seat cannot be selected more than once.",
      });
    }


    /* =====================================
       LOAD PRETIX SEATS
       ===================================== */

    const needsMainHall =
      cleanedSeats.some(
        seat =>
          seat.startsWith("mainHall-")
      );

    const needsWatchParty =
      cleanedSeats.some(
        seat =>
          seat.startsWith("watchParty-")
      );

    const [
      pretixMainHallSeats,
      pretixWatchPartySeats
    ] = await Promise.all([

      needsMainHall
        ? getPretixSeats(
            SEAT_ZONES.mainHall
          )
        : Promise.resolve([]),

      needsWatchParty
        ? getPretixSeats(
            SEAT_ZONES.watchParty
          )
        : Promise.resolve([])

    ]);


    /* =====================================
       RESOLVE REAL SEATS
       ===================================== */

    const resolvedSeats =
      cleanedSeats.map(
        temporarySeatId => {

          let pretixSeats = [];

          if (
            temporarySeatId
              .startsWith("mainHall-")
          ) {
            pretixSeats =
              pretixMainHallSeats;
          }

          if (
            temporarySeatId
              .startsWith("watchParty-")
          ) {
            pretixSeats =
              pretixWatchPartySeats;
          }

          const realSeat =
            findPretixSeat(
              temporarySeatId,
              pretixSeats
            );

          if (!realSeat) {
            throw new Error(
              `Seat ${temporarySeatId} could not be matched to an available Pretix seat.`
            );
          }

          return {
            temporaryId:
              temporarySeatId,

            seatGuid:
              realSeat.seat_guid,

            row:
              realSeat.row_name,

            seatNumber:
              realSeat.seat_number,
          };

        }
      );


    /* =====================================
       CREATE CART
       ===================================== */

    const cartId =
      `tedx-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}@api`;

    const expires =
      new Date(
        Date.now() +
        CART_SECONDS * 1000
      ).toISOString();

    const createdPositions = [];


    /* =====================================
       CREATE CART POSITIONS
       ===================================== */

    for (
      let index = 0;
      index < reservedTickets.length;
      index++
    ) {

      const ticket =
        reservedTickets[index];

      const resolvedSeat =
        resolvedSeats[index];

      const payload = {

        cart_id:
          cartId,

        item:
          ticket.item,

        variation:
          ticket.variation,

        price:
          ticket.price,

        seat:
          resolvedSeat.seatGuid,

        expires:
          expires,

      };


      const response =
        await fetch(
          `${PRETIX_BASE}/cartpositions/`,
          {
            method: "POST",

            headers: {
              Authorization:
                `Token ${process.env.PRETIX_API_TOKEN}`,

              Accept:
                "application/json",

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(payload),
          }
        );


      const text =
        await response.text();

      let data;

      try {
        data =
          JSON.parse(text);
      } catch {
        data =
          text;
      }


      /* ===================================
         CLEANUP ON FAILURE
         =================================== */

      if (!response.ok) {

        for (
          const created
          of createdPositions
        ) {

          await fetch(
            `${PRETIX_BASE}/cartpositions/${created.id}/`,
            {
              method: "DELETE",

              headers: {
                Authorization:
                  `Token ${process.env.PRETIX_API_TOKEN}`,

                Accept:
                  "application/json",
              },
            }
          );

        }

        return res.status(
          response.status
        ).json({

          success: false,

          error:
            "Could not reserve all selected seats.",

          failed_ticket: {
            type:
              ticket.ticket_type,

            temporary_seat:
              resolvedSeat.temporaryId,

            pretix_seat:
              resolvedSeat.seatGuid,

            early_bird:
              ticket.early_bird,
          },

          pretix:
            data,
        });

      }


      createdPositions.push(data);

    }


    /* =====================================
       SAVE CART IN REDIS
       ===================================== */

    const cartKey =
      `tedx:cart:${checkoutId}`;

    await redis.set(
      cartKey,
      {
        checkoutId,
        cartId,
        expires,
        seats: resolvedSeats,
        positions: createdPositions.map(
          position => ({
            id: position.id,
            cartId:
              position.cart_id,
          })
        ),
        tickets: reservedTickets,
        createdAt:
          new Date().toISOString(),
      },
      {
        ex:
          CART_SECONDS,
      }
    );


    /* =====================================
       SUCCESS
       ===================================== */

    return res.status(201).json({

      success: true,

      checkout_id:
        checkoutId,

      cart_id:
        cartId,

      expires:
        expires,

      tickets:
        resolvedSeats.map(
          (seat, index) => ({

            type:
              reservedTickets[index]
                .ticket_type,

            early_bird:
              reservedTickets[index]
                .early_bird,

            variation:
              reservedTickets[index]
                .variation,

            price:
              reservedTickets[index]
                .price,

            temporary_seat:
              seat.temporaryId,

            pretix_seat:
              seat.seatGuid,

            cart_position_id:
              createdPositions[index]?.id,

          })
        ),

      pretix_positions:
        createdPositions,

    });

  } catch (error) {

    console.error(
      "Create cart error:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Could not create Pretix cart.",

    });

  }

}
