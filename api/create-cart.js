import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const MAX_TICKETS_PER_ORDER = 10;

const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

export default async function handler(req, res) {
  // --------------------------------------------------
  // 1. ONLY ALLOW POST
  // --------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  try {
    const body = req.body;

    // --------------------------------------------------
    // 2. BASIC VALIDATION
    // --------------------------------------------------

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        success: false,
        error: "Invalid request body.",
      });
    }

    const { checkoutId, seats } = body;

    if (
      typeof checkoutId !== "string" ||
      checkoutId.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "checkoutId is required.",
      });
    }

    if (!Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({
        success: false,
        error: "seats must be a non-empty array.",
      });
    }

    if (seats.length > MAX_TICKETS_PER_ORDER) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_TICKETS_PER_ORDER} tickets per order.`,
      });
    }

    // --------------------------------------------------
    // 3. GET THE CHECKOUT RESERVATION FROM REDIS
    // --------------------------------------------------

    const checkoutKey = `tedx:checkout:${checkoutId}`;

    const checkout = await redis.get(checkoutKey);

    if (!checkout) {
      return res.status(400).json({
        success: false,
        error:
          "This checkout has expired or could not be found. Please start again.",
      });
    }

    // --------------------------------------------------
    // 4. VALIDATE CHECKOUT DATA
    // --------------------------------------------------

    if (
      !checkout ||
      !Array.isArray(checkout.tickets) ||
      checkout.tickets.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid checkout reservation.",
      });
    }

    const reservedTickets = checkout.tickets;

    if (reservedTickets.length !== seats.length) {
      return res.status(400).json({
        success: false,
        error:
          "The number of selected seats does not match the number of tickets.",
      });
    }

    // --------------------------------------------------
    // 5. VALIDATE SEATS
    // --------------------------------------------------

    const cleanedSeats = seats.map((seat) => {
      if (typeof seat !== "string" || seat.trim() === "") {
        return null;
      }

      return seat.trim();
    });

    if (cleanedSeats.some((seat) => seat === null)) {
      return res.status(400).json({
        success: false,
        error: "Every ticket must have a valid seat.",
      });
    }

    // Prevent the same seat being submitted twice.
    const uniqueSeats = new Set(cleanedSeats);

    if (uniqueSeats.size !== cleanedSeats.length) {
      return res.status(400).json({
        success: false,
        error: "The same seat cannot be selected more than once.",
      });
    }

    // --------------------------------------------------
    // 6. ATTACH SEATS TO THE EXACT RESERVED TICKETS
    // --------------------------------------------------

    const resolvedTickets = reservedTickets.map(
      (ticket, index) => ({
        ...ticket,
        seat: cleanedSeats[index],
      })
    );

    // --------------------------------------------------
    // 7. CREATE ONE PRETIX CART ID
    // --------------------------------------------------

    const cartId =
      `tedx-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}@api`;

    const expires = new Date(
      Date.now() + 15 * 60 * 1000
    ).toISOString();

    // --------------------------------------------------
    // 8. CREATE PRETIX CART POSITIONS
    // --------------------------------------------------

    const createdPositions = [];

    for (const ticket of resolvedTickets) {
      const payload = {
        cart_id: cartId,
        item: ticket.item,
        variation: ticket.variation,
        price: ticket.price,
        seat: ticket.seat,
        expires,
      };

      const response = await fetch(
        `${PRETIX_BASE}/cartpositions/`,
        {
          method: "POST",

          headers: {
            Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        }
      );

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        // ------------------------------------------------
        // CLEAN UP ANY POSITIONS ALREADY CREATED
        // ------------------------------------------------

        for (const created of createdPositions) {
          await fetch(
            `${PRETIX_BASE}/cartpositions/${created.id}/`,
            {
              method: "DELETE",

              headers: {
                Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
                Accept: "application/json",
              },
            }
          );
        }

        return res.status(response.status).json({
          success: false,
          error: "Could not reserve all selected seats.",
          failed_ticket: {
            type: ticket.ticket_type,
            seat: ticket.seat,
            early_bird: ticket.early_bird,
          },
          pretix: data,
        });
      }

      createdPositions.push(data);
    }

    // --------------------------------------------------
    // 9. SUCCESS
    // --------------------------------------------------

    return res.status(201).json({
      success: true,

      checkout_id: checkoutId,

      cart_id: cartId,

      expires,

      tickets: resolvedTickets.map((ticket, index) => ({
        type: ticket.ticket_type,
        early_bird: ticket.early_bird,
        variation: ticket.variation,
        price: ticket.price,
        seat: ticket.seat,
        cart_position_id:
          createdPositions[index]?.id,
      })),

      pretix_positions: createdPositions,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
