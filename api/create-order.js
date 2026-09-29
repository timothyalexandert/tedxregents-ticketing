import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

const MAX_TICKETS_PER_ORDER = 10;


/* =========================================
   LOAD TICKET INFORMATION FROM PRETIX
   ========================================= */

async function loadTicketInformation(orderCode, expectedTicketCount) {

  const positionsResponse =
    await fetch(
      `${PRETIX_BASE}/orderpositions/?order=${encodeURIComponent(
        orderCode
      )}`,
      {
        method: "GET",

        headers: {
          Authorization:
            `Token ${process.env.PRETIX_API_TOKEN}`,

          Accept:
            "application/json",
        },
      }
    );


  const positionsText =
    await positionsResponse.text();

  let positionsData;

  try {
    positionsData =
      JSON.parse(
        positionsText
      );
  } catch {
    positionsData =
      positionsText;
  }


  if (
    !positionsResponse.ok
  ) {

    console.error(
      "Could not load Pretix order positions:",
      JSON.stringify(
        positionsData,
        null,
        2
      )
    );

    throw new Error(
      "The order was created, but the ticket information could not be loaded."
    );

  }


  const ticketPositions =
    Array.isArray(
      positionsData.results
    )
      ? positionsData.results.filter(
          position =>
            position.addon_to == null
        )
      : [];


  if (
    ticketPositions.length !==
    expectedTicketCount
  ) {

    console.error(
      "Unexpected Pretix ticket position count:",
      {
        expected:
          expectedTicketCount,

        received:
          ticketPositions.length,

        positions:
          positionsData.results,
      }
    );

    throw new Error(
      "The order was created, but the ticket information is incomplete."
    );

  }


  return ticketPositions.map(
    position => ({

      positionId:
        position.positionid,

      secret:
        position.secret,

      attendeeName:
        position.attendee_name,

      attendeeEmail:
        position.attendee_email,

      item:
        position.item,

      variation:
        position.variation,

      seat:
        position.seat,

    })
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

    const body =
      req.body;


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
      cartId,
      paymentMethod,
      paymentProofName,
      ordererDetails,
      attendees,
      addons
    } = body;


    /* =====================================
       VALIDATE CHECKOUT
       ===================================== */

    if (
      typeof checkoutId !== "string" ||
      !checkoutId.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "checkoutId is required.",
      });
    }


    /* =====================================
       LOAD CHECKOUT
       ===================================== */

    const checkout =
      await redis.get(
        `tedx:checkout:${checkoutId}`
      );


    if (!checkout) {
      return res.status(400).json({
        success: false,
        error:
          "Your checkout has expired. Please start again.",
      });
    }


    /* =====================================
       VALIDATE TICKETS
       ===================================== */

    const tickets =
      checkout.tickets;


    if (
      !Array.isArray(tickets) ||
      tickets.length === 0 ||
      tickets.length >
        MAX_TICKETS_PER_ORDER
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid ticket reservation.",
      });
    }


    /* =====================================
       LOAD CART
       ===================================== */

    const savedCart =
      await redis.get(
        `tedx:cart:${checkoutId}`
      );


    if (!savedCart) {
      return res.status(400).json({
        success: false,
        error:
          "Your seat reservation has expired. Please select your seats again.",
      });
    }


    if (
      cartId &&
      savedCart.cartId !== cartId
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid ticket reservation.",
      });
    }


    /* =====================================
       CHECK FOR EXISTING ORDER
       ===================================== */

    const existingOrder =
      await redis.get(
        `tedx:order:${checkoutId}`
      );


    if (existingOrder) {

      /*
        If the order already has ticket
        information, simply return it.
      */

      if (
        Array.isArray(
          existingOrder.tickets
        ) &&
        existingOrder.tickets.length > 0
      ) {

        return res.status(200).json({
          success: true,
          existing: true,
          order:
            existingOrder,
        });

      }


      /*
        Existing order does not have ticket
        information yet.

        This handles older orders such as
        the current 7MLCS order.
      */

      try {

        const ticketInformation =
          await loadTicketInformation(
            existingOrder.orderCode,
            tickets.length
          );


        const updatedOrder = {

          ...existingOrder,

          tickets:
            ticketInformation,

        };


        await redis.set(
          `tedx:order:${checkoutId}`,
          updatedOrder
        );


        return res.status(200).json({

          success: true,

          existing: true,

          order:
            updatedOrder,

        });

      } catch (error) {

        console.error(
          "Existing order ticket backfill failed:",
          error
        );

        return res.status(500).json({

          success: false,

          error:
            error.message ||
            "The existing order was found, but its ticket information could not be loaded.",

        });

      }

    }


    /* =====================================
       VALIDATE CUSTOMER
       ===================================== */

    if (
      !ordererDetails ||
      typeof ordererDetails !== "object"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Orderer details are required.",
      });
    }


    const ordererName =
      String(
        ordererDetails.name || ""
      ).trim();


    const ordererEmail =
      String(
        ordererDetails.email || ""
      ).trim();


    let ordererPhone =
      String(
        ordererDetails.phone || ""
      ).trim();


    ordererPhone =
      ordererPhone.replace(
        /[\s()-]/g,
        ""
      );


    if (
      ordererPhone.startsWith("08")
    ) {
      ordererPhone =
        "+62" +
        ordererPhone.slice(1);
    }


    if (
      ordererPhone.startsWith("62")
    ) {
      ordererPhone =
        "+" +
        ordererPhone;
    }


    if (
      !ordererName ||
      !ordererEmail ||
      !ordererPhone
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Name, email and phone are required.",
      });
    }


    /* =====================================
       VALIDATE ATTENDEES
       ===================================== */

    if (
      !Array.isArray(attendees) ||
      attendees.length !== tickets.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The number of attendees does not match the number of tickets.",
      });
    }


    for (
      const attendee
      of attendees
    ) {

      if (
        !attendee ||
        !String(
          attendee.name || ""
        ).trim() ||
        !String(
          attendee.email || ""
        ).trim() ||
        !String(
          attendee.phone || ""
        ).trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Every attendee must have a name, email and phone number.",
        });
      }

    }


    /* =====================================
       VALIDATE PAYMENT METHOD
       ===================================== */

    if (
      paymentMethod !== "cash" &&
      paymentMethod !== "bank"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid payment method.",
      });
    }


    if (
      paymentMethod === "bank" &&
      !paymentProofName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Bank transfer payment proof is required.",
      });
    }


    /* =====================================
       BUILD ORDER POSITIONS
       ===================================== */

    const positions = [];

    let positionId = 1;


    for (
      let index = 0;
      index < tickets.length;
      index++
    ) {

      const ticket =
        tickets[index];


      const attendee =
        attendees[index];


      const savedSeat =
        savedCart.seats?.[index];


      if (!savedSeat?.seatGuid) {
        return res.status(400).json({
          success: false,
          error:
            "A reserved seat could not be found.",
        });
      }


      positions.push({

        positionid:
          positionId,

        item:
          Number(ticket.item),

        variation:
          Number(ticket.variation),

        price:
          String(ticket.price),

        seat:
          savedSeat.seatGuid,

        attendee_name:
          String(
            attendee.name
          ).trim(),

        attendee_email:
          String(
            attendee.email
          ).trim(),

      });


      positionId++;

    }


    /* =====================================
       ADD-ONS
       ===================================== */

    const ADDONS = [
      {
        key: "toteBag",
        item: 1162126,
        price: 60000,
      },
      {
        key: "notebook",
        item: 1162127,
        price: 30000,
      },
      {
        key: "pen",
        item: 1162128,
        price: 10000,
      },
      {
        key: "lanyard",
        item: 1162129,
        price: 15000,
      },
      {
        key: "stickerPack",
        item: 1162130,
        price: 3000,
      },
      {
        key: "food",
        item: 1162131,
        price: 30000,
      },
    ];


    const firstTicketPositionId =
      1;


    if (
      addons &&
      typeof addons === "object"
    ) {

      for (
        const addon
        of ADDONS
      ) {

        const quantity =
          Number(
            addons[addon.key] || 0
          );


        if (
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {
          continue;
        }


        if (
          quantity > 100
        ) {
          return res.status(400).json({
            success: false,
            error:
              `Invalid quantity for ${addon.key}.`,
          });
        }


        positions.push({

          positionid:
            positionId,

          item:
            addon.item,

          price:
            String(
              addon.price * quantity
            ),

          count:
            quantity,

          addon_to:
            firstTicketPositionId,

        });


        positionId++;

      }

    }


    /* =====================================
       BUILD PAYMENT INFORMATION
       ===================================== */

    const paymentInfo = {

      method:
        paymentMethod,

      proof_name:
        paymentProofName || null,

      status:
        "pending",

    };


    /* =====================================
       BUILD ORDER
       ===================================== */

    const orderPayload = {

      email:
        ordererEmail,

      payment_provider:
        "manual",

      payment_info:
        paymentInfo,

      comment:
        `Orderer: ${ordererName}`,

      api_meta:
        JSON.stringify({

          checkout_id:
            checkoutId,

          payment_method:
            paymentMethod,

          payment_proof_name:
            paymentProofName || null,

        }),

      positions:
        positions,

      consume_carts: [
        savedCart.cartId
      ],

    };


    /* =====================================
       CREATE PRETIX ORDER
       ===================================== */

    const response =
      await fetch(
        `${PRETIX_BASE}/orders/`,
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
            JSON.stringify(
              orderPayload
            ),

        }
      );


    const responseText =
      await response.text();


    let pretixData;


    try {

      pretixData =
        JSON.parse(
          responseText
        );

    } catch {

      pretixData =
        responseText;

    }


    /* =====================================
       CHECK PRETIX RESPONSE
       ===================================== */

    if (!response.ok) {

      console.error(
        "Pretix order creation failed:",
        JSON.stringify(
          pretixData,
          null,
          2
        )
      );


      return res.status(
        response.status
      ).json({

        success: false,

        error:
          "Pretix rejected the order: " +
          JSON.stringify(
            pretixData
          ),

        pretix:
          pretixData,

      });

    }


    /* =====================================
       LOAD TICKET POSITIONS
       ===================================== */

    let ticketInformation;


    try {

      ticketInformation =
        await loadTicketInformation(
          pretixData.code,
          tickets.length
        );

    } catch (error) {

      console.error(
        "Could not load ticket information:",
        error
      );


      return res.status(500).json({

        success: false,

        error:
          error.message ||
          "The order was created, but the ticket information could not be loaded.",

      });

    }


    /* =====================================
       SAVE ORDER IN REDIS
       ===================================== */

    const orderRecord = {

      orderCode:
        pretixData.code,

      status:
        pretixData.status,

      paymentMethod:
        paymentMethod,

      paymentProofName:
        paymentProofName || null,

      checkoutId:
        checkoutId,

      cartId:
        savedCart.cartId,

      tickets:
        ticketInformation,

      pretix:
        pretixData,

      createdAt:
        new Date().toISOString(),

    };


    await redis.set(
      `tedx:order:${checkoutId}`,
      orderRecord
    );


    /* =====================================
       SUCCESS
       ===================================== */

    return res.status(201).json({

      success: true,

      order:
        orderRecord,

    });


  } catch (error) {

    console.error(
      "Create order error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Could not create Pretix order.",

    });

  }

}
```
