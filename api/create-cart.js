const TICKETS = {
  mainhall: {
    item: 1162153,

    earlyBird: {
      variation: 1044379,
      price: "40000.00",
    },

    regular: {
      variation: 1044380,
      price: "45000.00",
    },

    vipEarlyBird: {
      variation: 1044381,
      price: "50000.00",
    },

    vipRegular: {
      variation: 1044382,
      price: "55000.00",
    },
  },

  watchparty: {
    item: 1162179,

    earlyBird: {
      variation: 1044384,
      price: "25000.00",
    },

    regular: {
      variation: 1044383,
      price: "30000.00",
    },
  },
};

const MAX_TICKETS_PER_ORDER = 10;

const MAINHALL_EB_LIMIT = 10;
const WATCHPARTY_EB_LIMIT = 10;

const MAINHALL_ITEM = 1162153;
const WATCHPARTY_ITEM = 1162179;

const MAINHALL_EB_VARIATIONS = [1044379, 1044381];
const WATCHPARTY_EB_VARIATIONS = [1044384];

const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  try {
    const body = req.body;

    if (!body || !Array.isArray(body.tickets)) {
      return res.status(400).json({
        success: false,
        error: "tickets must be an array.",
      });
    }

    const tickets = body.tickets;

    // --------------------------------------------------
    // 1. BASIC VALIDATION
    // --------------------------------------------------

    if (tickets.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one ticket is required.",
      });
    }

    if (tickets.length > MAX_TICKETS_PER_ORDER) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_TICKETS_PER_ORDER} tickets per order.`,
      });
    }

    for (const ticket of tickets) {
      if (!ticket || typeof ticket !== "object") {
        return res.status(400).json({
          success: false,
          error: "Invalid ticket data.",
        });
      }

      if (
        ticket.type !== "mainhall" &&
        ticket.type !== "watchparty"
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid ticket type.",
        });
      }

      if (
        typeof ticket.seat !== "string" ||
        ticket.seat.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          error: "Every ticket must have a seat.",
        });
      }

      if (
        ticket.type === "mainhall" &&
        typeof ticket.vip !== "boolean"
      ) {
        return res.status(400).json({
          success: false,
          error: "Main Hall tickets must specify vip: true or false.",
        });
      }

      if (
        ticket.type === "watchparty" &&
        ticket.vip !== undefined
      ) {
        return res.status(400).json({
          success: false,
          error: "Watch Party tickets cannot be VIP.",
        });
      }
    }

    // --------------------------------------------------
    // 2. COUNT TICKETS IN EACH EARLY-BIRD POOL
    // --------------------------------------------------

    const mainHallTickets = tickets.filter(
      (ticket) => ticket.type === "mainhall"
    );

    const watchPartyTickets = tickets.filter(
      (ticket) => ticket.type === "watchparty"
    );

    // --------------------------------------------------
    // 3. GET CURRENT API CART POSITIONS
    // --------------------------------------------------

    const cartResponse = await fetch(
      `${PRETIX_BASE}/cartpositions/?limit=100`,
      {
        headers: {
          Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    const cartData = await cartResponse.json();

    if (!cartResponse.ok) {
      return res.status(502).json({
        success: false,
        error: "Could not check current ticket reservations.",
        pretix: cartData,
      });
    }

    const now = Date.now();

    const activePositions = (cartData.results || []).filter(
      (position) => {
        if (!position.expires) return false;

        return new Date(position.expires).getTime() > now;
      }
    );

    // --------------------------------------------------
    // 4. COUNT ACTIVE EARLY-BIRD RESERVATIONS
    // --------------------------------------------------

    const mainHallEarlyBirdCount = activePositions.filter(
      (position) =>
        position.item === MAINHALL_ITEM &&
        MAINHALL_EB_VARIATIONS.includes(position.variation)
    ).length;

    const watchPartyEarlyBirdCount = activePositions.filter(
      (position) =>
        position.item === WATCHPARTY_ITEM &&
        WATCHPARTY_EB_VARIATIONS.includes(position.variation)
    ).length;

    // --------------------------------------------------
    // 5. DETERMINE WHICH TICKETS GET EARLY BIRD
    // --------------------------------------------------

    let mainHallEBRemaining =
      MAINHALL_EB_LIMIT - mainHallEarlyBirdCount;

    let watchPartyEBRemaining =
      WATCHPARTY_EB_LIMIT - watchPartyEarlyBirdCount;

    if (mainHallEBRemaining < 0) {
      mainHallEBRemaining = 0;
    }

    if (watchPartyEBRemaining < 0) {
      watchPartyEBRemaining = 0;
    }

    const resolvedTickets = [];

    // Main Hall + VIP share the SAME Early Bird pool
    for (const ticket of mainHallTickets) {
      const config = TICKETS.mainhall;

      let selected;

      if (mainHallEBRemaining > 0) {
        selected = ticket.vip
          ? config.vipEarlyBird
          : config.earlyBird;

        mainHallEBRemaining--;
      } else {
        selected = ticket.vip
          ? config.vipRegular
          : config.regular;
      }

      resolvedTickets.push({
        ...ticket,
        item: config.item,
        variation: selected.variation,
        price: selected.price,
        ticket_type: ticket.vip ? "vip" : "mainhall",
        early_bird:
          selected === config.vipEarlyBird ||
          selected === config.earlyBird,
      });
    }

    // Watch Party has its OWN Early Bird pool
    for (const ticket of watchPartyTickets) {
      const config = TICKETS.watchparty;

      let selected;

      if (watchPartyEBRemaining > 0) {
        selected = config.earlyBird;
        watchPartyEBRemaining--;
      } else {
        selected = config.regular;
      }

      resolvedTickets.push({
        ...ticket,
        item: config.item,
        variation: selected.variation,
        price: selected.price,
        ticket_type: "watchparty",
        early_bird: selected === config.earlyBird,
      });
    }

    // --------------------------------------------------
    // 6. CREATE ONE CART ID
    // --------------------------------------------------

    const cartId =
      `tedx-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}@api`;

    const expires = new Date(
      Date.now() + 15 * 60 * 1000
    ).toISOString();

    // --------------------------------------------------
    // 7. CREATE CART POSITIONS
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
        // If one ticket fails, remove the positions
        // that were already created for this cart.
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
          failed_ticket: ticket,
          pretix: data,
        });
      }

      createdPositions.push(data);
    }

    // --------------------------------------------------
    // 8. SUCCESS
    // --------------------------------------------------

    return res.status(201).json({
      success: true,

      cart_id: cartId,

      expires,

      tickets: resolvedTickets.map((ticket, index) => ({
        type: ticket.ticket_type,
        early_bird: ticket.early_bird,
        variation: ticket.variation,
        price: ticket.price,
        seat: ticket.seat,
        cart_position_id: createdPositions[index]?.id,
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
