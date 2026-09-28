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
            now + CHECKOUT_SECONDS * 1000;

        /*
         * Read current Early Bird reservations.
         *
         * We use Redis sorted sets where each reservation
         * expires automatically when its score is reached.
         */

        await redis.zremrangebyscore(
            MAIN_VIP_POOL,
            0,
            now
        );

        await redis.zremrangebyscore(
            WATCH_POOL,
            0,
            now
        );

        const mainVipUsed =
            await redis.zcard(MAIN_VIP_POOL);

        const watchUsed =
            await redis.zcard(WATCH_POOL);

        const mainVipAvailable =
            Math.max(
                0,
                EARLY_BIRD_LIMIT - mainVipUsed
            );

        const watchAvailable =
            Math.max(
                0,
                EARLY_BIRD_LIMIT - watchUsed
            );

        /*
         * Allocate Early Bird slots.
         *
         * Main Hall + VIP share one pool.
         * Watch Party has its own pool.
         */

        const mainVipRequested =
            mainHall + vip;

        const mainVipEarlyBird =
            Math.min(
                mainVipRequested,
                mainVipAvailable
            );

        const watchEarlyBird =
            Math.min(
                watchParty,
                watchAvailable
            );

        /*
         * Reserve the Early Bird slots.
         */

        for (
            let i = 1;
            i <= mainVipEarlyBird;
            i++
        ) {
            await redis.zadd(
                MAIN_VIP_POOL,
                {
                    score: expiresAt,
                    member:
                        `${checkoutId}:main:${i}`
                }
            );
        }

        for (
            let i = 1;
            i <= watchEarlyBird;
            i++
        ) {
            await redis.zadd(
                WATCH_POOL,
                {
                    score: expiresAt,
                    member:
                        `${checkoutId}:watch:${i}`
                }
            );
        }

        /*
         * Distribute Main Hall/VIP Early Bird slots
         * proportionally when the shared pool is partially
         * available.
         */

        let mainHallEarlyBird = 0;
        let vipEarlyBird = 0;

        if (mainVipEarlyBird > 0) {

            if (mainHall === 0) {

                vipEarlyBird =
                    mainVipEarlyBird;

            } else if (vip === 0) {

                mainHallEarlyBird =
                    mainVipEarlyBird;

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

        /*
         * Build the exact ticket allocation.
         */

        const tickets = [];

        // Main Hall
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

        // VIP
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

        // Watch Party
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
         * Save the exact checkout allocation.
         */

        const reservationKey =
            `tedx:checkout:${checkoutId}`;

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
