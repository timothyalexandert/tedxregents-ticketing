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

// Redis keys
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

        const totalTickets =
            mainHall +
            vip +
            watchParty;

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
                    error:
                        `You can purchase a maximum of ${MAX_TICKETS} tickets per order.`
                },
                400
            );
        }

        const checkoutId = crypto.randomUUID();

        const now = Date.now();
        const expiresAt =
            now +
            CHECKOUT_SECONDS * 1000;

        const mainVipRequested =
            mainHall + vip;

        const watchRequested =
            watchParty;

        /*
         * Redis Lua script.
         *
         * This operation is atomic:
         *
         * 1. Remove expired reservations
         * 2. Count remaining EB slots
         * 3. Allocate as many EB slots as possible
         * 4. Create the temporary reservation
         *
         * Main Hall + VIP share one pool.
         * Watch Party has a separate pool.
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

            local mainUsed =
                redis.call("ZCARD", mainPool)

            local watchUsed =
                redis.call("ZCARD", watchPool)

            local mainAvailable =
                10 - mainUsed

            local watchAvailable =
                10 - watchUsed

            if mainAvailable < 0 then
                mainAvailable = 0
            end

            if watchAvailable < 0 then
                watchAvailable = 0
            end

            -- Give as many EB tickets as are available.
            local mainEb =
                math.min(
                    mainRequested,
                    mainAvailable
                )

            local watchEb =
                math.min(
                    watchRequested,
                    watchAvailable
                )

            -- Reserve Main Hall/VIP EB slots.
            for i = 1, mainEb do
                local member =
                    checkoutId ..
                    ":main:" ..
                    tostring(i)

                redis.call(
                    "ZADD",
                    mainPool,
                    expiresAt,
                    member
                )
            end

            -- Reserve Watch Party EB slots.
            for i = 1, watchEb do
                local member =
                    checkoutId ..
                    ":watch:" ..
                    tostring(i)

                redis.call(
                    "ZADD",
                    watchPool,
                    expiresAt,
                    member
                )
            end

            -- Store checkout reservation.
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

        const reservationKey =
            `tedx:checkout:${checkoutId}`;

        const initialReservation = JSON.stringify({
            checkoutId,
            createdAt: now,
            expiresAt,
            quantities: {
                mainHall,
                vip,
                watchParty
            }
        });

        const result = await redis.eval(
            allocationScript,
            [
                MAIN_VIP_POOL,
                WATCH_POOL,
                reservationKey
            ],
            [
                now,
                expiresAt,
                checkoutId,
                mainVipRequested,
                watchRequested,
                initialReservation
            ]
        );

        if (
            !result ||
            result[0] !== "OK"
        ) {
            return json(
                {
                    success: false,
                    error:
                        "Unable to reserve Early Bird tickets."
                },
                409
            );
        }

        const mainVipEarlyBird =
            Number(result[1]);

        const watchPartyEarlyBird =
            Number(result[2]);

        /*
         * PROPORTIONAL ALLOCATION
         *
         * Main Hall and VIP share the same EB pool.
         *
         * Example:
         *
         * 2 Main Hall + 3 VIP
         * 2 EB slots remaining
         *
         * Main Hall share = 40%
         * VIP share = 60%
         *
         * Exact:
         * Main Hall = 0.8
         * VIP = 1.2
         *
         * Largest remainder:
         * Main Hall = 1
         * VIP = 1
         */

        let mainHallEarlyBird = 0;
        let vipEarlyBird = 0;

        if (mainVipEarlyBird > 0) {
            if (mainHall === 0) {
                vipEarlyBird =
                    Math.min(
                        vip,
                        mainVipEarlyBird
                    );
            } else if (vip === 0) {
                mainHallEarlyBird =
                    Math.min(
                        mainHall,
                        mainVipEarlyBird
                    );
            } else {
                const totalMainVip =
                    mainHall + vip;

                const mainExact =
                    (
                        mainHall /
                        totalMainVip
                    ) *
                    mainVipEarlyBird;

                const vipExact =
                    (
                        vip /
                        totalMainVip
                    ) *
                    mainVipEarlyBird;

                mainHallEarlyBird =
                    Math.floor(mainExact);

                vipEarlyBird =
                    Math.floor(vipExact);

                let remaining =
                    mainVipEarlyBird -
                    mainHallEarlyBird -
                    vipEarlyBird;

                const mainRemainder =
                    mainExact -
                    mainHallEarlyBird;

                const vipRemainder =
                    vipExact -
                    vipEarlyBird;

                while (remaining > 0) {
                    if (
                        vipRemainder >
                        mainRemainder
                    ) {
                        vipEarlyBird++;
                    } else {
                        mainHallEarlyBird++;
                    }

                    remaining--;
                }

                // Safety limits
                mainHallEarlyBird =
                    Math.min(
                        mainHallEarlyBird,
                        mainHall
                    );

                vipEarlyBird =
                    Math.min(
                        vipEarlyBird,
                        vip
                    );
            }
        }

        const watchEarlyBird =
            Math.min(
                watchParty,
                watchPartyEarlyBird
            );

        const tickets = [];

        // Main Hall tickets
        for (
            let i = 0;
            i < mainHall;
            i++
        ) {
            const earlyBird =
                i < mainHallEarlyBird;

            tickets.push({
                type: "mainhall",
                vip: false,
                early_bird: earlyBird,
                variation: earlyBird
                    ? MAIN_HALL_EB
                    : MAIN_HALL_REGULAR,
                price: earlyBird
                    ? 40000
                    : 45000
            });
        }

        // VIP tickets
        for (
            let i = 0;
            i < vip;
            i++
        ) {
            const earlyBird =
                i < vipEarlyBird;

            tickets.push({
                type: "mainhall",
                vip: true,
                early_bird: earlyBird,
                variation: earlyBird
                    ? VIP_EB
                    : VIP_REGULAR,
                price: earlyBird
                    ? 50000
                    : 55000
            });
        }

        // Watch Party tickets
        for (
            let i = 0;
            i < watchParty;
            i++
        ) {
            const earlyBird =
                i < watchEarlyBird;

            tickets.push({
                type: "watchparty",
                vip: false,
                early_bird: earlyBird,
                variation: earlyBird
                    ? WATCH_PARTY_EB
                    : WATCH_PARTY_REGULAR,
                price: earlyBird
                    ? 25000
                    : 30000
            });
        }

        const totalPrice =
            tickets.reduce(
                (sum, ticket) =>
                    sum + ticket.price,
                0
            );

        /*
         * Save the FINAL ticket allocation.
         *
         * This is what later checkout steps will use.
         */
        await redis.set(
            reservationKey,
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

            createdAt:
                new Date(now).toISOString(),

            expiresAt:
                new Date(
                    expiresAt
                ).toISOString(),

            expiresInSeconds:
                CHECKOUT_SECONDS,

            tickets,

            totalTickets,

            totalPrice
        });

    } catch (error) {
        console.error(
            "start-checkout error:",
            error
        );

        return json(
            {
                success: false,
                error:
                    "Something went wrong while starting checkout."
            },
            500
        );
    }
}
