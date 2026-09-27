import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = Redis.fromEnv();

const MAX_TICKETS = 10;
const EARLY_BIRD_LIMIT = 10;
const CHECKOUT_SECONDS = 15 * 60;

// Pretix variation IDs
const MAIN_HALL_EB = "1044379";
const MAIN_HALL_REGULAR = "1044380";
const VIP_EB = "1044381";
const VIP_REGULAR = "1044382";

const WATCH_PARTY_EB = "1044384";
const WATCH_PARTY_REGULAR = "1044383";

// Redis keys for the two Early Bird pools
const MAIN_VIP_POOL = "tedx:eb:main-vip";
const WATCH_POOL = "tedx:eb:watch";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        }
    });
}

export default async function handler(req) {
    if (req.method !== "POST") {
        return json(
            {
                success: false,
                error: "Method not allowed."
            },
            405
        );
    }

    try {
        const body = await req.json();
        const quantities = body.quantities;

        if (!quantities || typeof quantities !== "object") {
            return json(
                {
                    success: false,
                    error: "Missing ticket quantities."
                },
                400
            );
        }

        const mainHall = Number(quantities.mainHall) || 0;
        const vip = Number(quantities.vip) || 0;
        const watchParty = Number(quantities.watchParty) || 0;

        // Validate quantities
        if (
            !Number.isInteger(mainHall) ||
            !Number.isInteger(vip) ||
            !Number.isInteger(watchParty) ||
            mainHall < 0 ||
            vip < 0 ||
            watchParty < 0
        ) {
            return json(
                {
                    success: false,
                    error: "Invalid ticket quantities."
                },
                400
            );
        }

        const totalTickets = mainHall + vip + watchParty;

        if (totalTickets < 1) {
            return json(
                {
                    success: false,
                    error: "Please select at least one ticket."
                },
                400
            );
        }

        if (totalTickets > MAX_TICKETS) {
            return json(
                {
                    success: false,
                    error: `You can purchase a maximum of ${MAX_TICKETS} tickets per order.`
                },
                400
            );
        }

        const checkoutId = crypto.randomUUID();

        const now = Date.now();
        const expiresAt = now + CHECKOUT_SECONDS * 1000;

        const mainVipRequested = mainHall + vip;
        const watchRequested = watchParty;

        /*
         * Atomically:
         *
         * 1. Remove expired EB reservations
         * 2. Check remaining EB capacity
         * 3. Allocate as many EB slots as possible
         * 4. Store the checkout reservation
         *
         * Any tickets that don't receive EB become Regular.
         */
        const allocationScript = `
            local mainPool = KEYS[1]
            local watchPool = KEYS[2]
            local reservationKey = KEYS[3]

            local now = tonumber(ARGV[1])
            local expiresAt = tonumber(ARGV[2])
            local checkoutId = ARGV[3]

            local mainRequested = tonumber(ARGV[4])
            local watchRequested = tonumber(ARGV[5])
            local reservationData = ARGV[6]

            -- Remove expired Main Hall/VIP reservations
            redis.call(
                "ZREMRANGEBYSCORE",
                mainPool,
                "-inf",
                now
            )

            -- Remove expired Watch Party reservations
            redis.call(
                "ZREMRANGEBYSCORE",
                watchPool,
                "-inf",
                now
            )

            local mainUsed = redis.call("ZCARD", mainPool)
            local watchUsed = redis.call("ZCARD", watchPool)

            local mainAvailable = 10 - mainUsed
            local watchAvailable = 10 - watchUsed

            if mainAvailable < 0 then
                mainAvailable = 0
            end

            if watchAvailable < 0 then
                watchAvailable = 0
            end

            -- Give as many EB tickets as are still available
            local mainEb = math.min(
                mainRequested,
                mainAvailable
            )

            local watchEb = math.min(
                watchRequested,
                watchAvailable
            )

            -- Create one temporary reservation entry
            -- for every Early Bird ticket.
            for i = 1, mainEb do
                local member =
                    checkoutId .. ":main:" .. tostring(i)

                redis.call(
                    "ZADD",
                    mainPool,
                    expiresAt,
                    member
                )
            end

            for i = 1, watchEb do
                local member =
                    checkoutId .. ":watch:" .. tostring(i)

                redis.call(
                    "ZADD",
                    watchPool,
                    expiresAt,
                    member
                )
            end

            -- Store the complete checkout reservation
            redis.call(
                "SET",
                reservationKey,
                reservationData,
                "EX",
                900
            )

            return {
                "OK",
                tostring(mainEb),
                tostring(watchEb)
            }
        `;

        const mainEbResultKey =
            `tedx:checkout:${checkoutId}`;

        /*
         * We initially calculate the allocation here.
         * The exact allocation is also stored in Redis below.
         */
        const result = await redis.eval(
            allocationScript,
            [
                MAIN_VIP_POOL,
                WATCH_POOL,
                mainEbResultKey
            ],
            [
                now,
                expiresAt,
                checkoutId,
                mainVipRequested,
                watchRequested,
                JSON.stringify({
                    checkoutId,
                    createdAt: now,
                    expiresAt,
                    quantities: {
                        mainHall,
                        vip,
                        watchParty
                    }
                })
            ]
        );

        if (!result || result[0] !== "OK") {
            return json(
                {
                    success: false,
                    error: "Unable to reserve Early Bird tickets."
                },
                409
            );
        }

        const mainVipEarlyBird = Number(result[1]);
        const watchPartyEarlyBird = Number(result[2]);

        /*
         * Allocate Main Hall EB tickets first,
         * then VIP EB tickets from the SAME pool.
         *
         * This is only the price allocation.
         * Actual seats are selected later.
         */
        const mainHallEarlyBird = Math.min(
            mainHall,
            mainVipEarlyBird
        );

        const vipEarlyBird = Math.min(
            vip,
            mainVipEarlyBird - mainHallEarlyBird
        );

        const watchEarlyBird = Math.min(
            watchParty,
            watchPartyEarlyBird
        );

        const tickets = [];

        // Main Hall
        for (let i = 0; i < mainHall; i++) {
            const earlyBird = i < mainHallEarlyBird;

            tickets.push({
                type: "mainhall",
                vip: false,
                early_bird: earlyBird,
                variation: earlyBird
                    ? MAIN_HALL_EB
                    : MAIN_HALL_REGULAR,
                price: earlyBird ? 40000 : 45000
            });
        }

        // VIP
        for (let i = 0; i < vip; i++) {
            const earlyBird = i < vipEarlyBird;

            tickets.push({
                type: "mainhall",
                vip: true,
                early_bird: earlyBird,
                variation: earlyBird
                    ? VIP_EB
                    : VIP_REGULAR,
                price: earlyBird ? 50000 : 55000
            });
        }

        // Watch Party
        for (let i = 0; i < watchParty; i++) {
            const earlyBird = i < watchEarlyBird;

            tickets.push({
                type: "watchparty",
                vip: false,
                early_bird: earlyBird,
                variation: earlyBird
                    ? WATCH_PARTY_EB
                    : WATCH_PARTY_REGULAR,
                price: earlyBird ? 25000 : 30000
            });
        }

        const totalPrice = tickets.reduce(
            (sum, ticket) => sum + ticket.price,
            0
        );

        /*
         * Update the stored reservation with the EXACT
         * ticket allocation that this checkout received.
         */
        await redis.set(
            mainEbResultKey,
            JSON.stringify({
                checkoutId,
                createdAt: now,
                expiresAt,
                quantities: {
                    mainHall,
                    vip,
                    watchParty
                },
                tickets
            }),
            {
                ex: CHECKOUT_SECONDS
            }
        );

        return json({
            success: true,
            checkoutId,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(expiresAt).toISOString(),
            expiresInSeconds: CHECKOUT_SECONDS,
            tickets,
            totalTickets,
            totalPrice
        });

    } catch (error) {
        console.error("start-checkout error:", error);

        return json(
            {
                success: false,
                error: "Something went wrong while starting checkout."
            },
            500
        );
    }
}
