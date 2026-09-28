import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = Redis.fromEnv();

const MAX_TICKETS = 10;
const EARLY_BIRD_LIMIT = 10;
const CHECKOUT_SECONDS = 15 * 60;

// Pretix item IDs
const MAIN_HALL_ITEM = 1162153;
const WATCH_PARTY_ITEM = 1162179;

// Pretix variation IDs
const MAIN_HALL_EB = "1044379";
const MAIN_HALL_REGULAR = "1044380";

const VIP_EB = "1044381";
const VIP_REGULAR = "1044382";

const WATCH_PARTY_EB = "1044384";
const WATCH_PARTY_REGULAR = "1044383";

// Pretix quota IDs
const MAIN_HALL_EB_QUOTA = 6227773;
const WATCH_PARTY_EB_QUOTA = 6227039;

// Redis Early Bird pools
const MAIN_VIP_POOL = "tedx:eb:main-vip";
const WATCH_POOL = "tedx:eb:watch";

const PRETIX_BASE =
    "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";


function sendJson(res, data, status = 200) {

    return res.status(status).json(data);

}


async function getPretixQuotaAvailability(quotaId) {

    const response =
        await fetch(
            `${PRETIX_BASE}/quotas/${quotaId}/availability/`,
            {
                headers: {
                    Authorization:
                        `Token ${process.env.PRETIX_API_TOKEN}`,

                    Accept:
                        "application/json"
                }
            }
        );


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            data?.detail ||
            `Could not check Pretix quota ${quotaId}.`
        );

    }


    return data;

}


export default async function handler(req, res) {

    if (req.method !== "POST") {

        return sendJson(
            res,
            {
                success: false,
                error: "Method not allowed."
            },
            405
        );

    }


    try {

        const quantities =
            req.body?.quantities;


        if (
            !quantities ||
            typeof quantities !== "object"
        ) {

            return sendJson(
                res,
                {
                    success: false,
                    error: "Missing ticket quantities."
                },
                400
            );

        }


        const mainHall =
            Number(quantities.mainHall) || 0;

        const vip =
            Number(quantities.vip) || 0;

        const watchParty =
            Number(quantities.watchParty) || 0;


        // --------------------------------------------------
        // 1. VALIDATE QUANTITIES
        // --------------------------------------------------

        if (
            !Number.isInteger(mainHall) ||
            !Number.isInteger(vip) ||
            !Number.isInteger(watchParty) ||
            mainHall < 0 ||
            vip < 0 ||
            watchParty < 0
        ) {

            return sendJson(
                res,
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

            return sendJson(
                res,
                {
                    success: false,
                    error:
                        "Please select at least one ticket."
                },
                400
            );

        }


        if (totalTickets > MAX_TICKETS) {

            return sendJson(
                res,
                {
                    success: false,
                    error:
                        `You can purchase a maximum of ${MAX_TICKETS} tickets per order.`
                },
                400
            );

        }


        // --------------------------------------------------
        // 2. GET CURRENT PRETIX EB AVAILABILITY
        // --------------------------------------------------

        const [
            mainHallEBQuota,
            watchPartyEBQuota
        ] = await Promise.all([

            getPretixQuotaAvailability(
                MAIN_HALL_EB_QUOTA
            ),

            getPretixQuotaAvailability(
                WATCH_PARTY_EB_QUOTA
            )

        ]);


        const pretixMainVipEBAvailable =
            Math.max(
                0,
                Number(
                    mainHallEBQuota.available_number
                ) || 0
            );


        const pretixWatchEBAvailable =
            Math.max(
                0,
                Number(
                    watchPartyEBQuota.available_number
                ) || 0
            );


        // --------------------------------------------------
        // 3. REMOVE EXPIRED REDIS HOLDS
        // --------------------------------------------------

        const now =
            Date.now();


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


        // --------------------------------------------------
        // 4. COUNT OUR ACTIVE REDIS EB HOLDS
        // --------------------------------------------------

        const mainVipUsed =
            await redis.zcard(
                MAIN_VIP_POOL
            );


        const watchUsed =
            await redis.zcard(
                WATCH_POOL
            );


        const redisMainVipAvailable =
            Math.max(
                0,
                EARLY_BIRD_LIMIT -
                    mainVipUsed
            );


        const redisWatchAvailable =
            Math.max(
                0,
                EARLY_BIRD_LIMIT -
                    watchUsed
            );


        /*
         * The effective availability is limited by BOTH:
         *
         * 1. Pretix's actual EB quota
         * 2. Our own 15-minute price holds
         *
         * This prevents our Redis system from promising
         * more EB tickets than Pretix can actually accept.
         */

        const mainVipAvailable =
            Math.min(
                pretixMainVipEBAvailable,
                redisMainVipAvailable
            );


        const watchAvailable =
            Math.min(
                pretixWatchEBAvailable,
                redisWatchAvailable
            );


        // --------------------------------------------------
        // 5. DETERMINE EARLY BIRD ALLOCATION
        // --------------------------------------------------

        const mainVipRequested =
            mainHall +
            vip;


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


        // --------------------------------------------------
        // 6. RESERVE REDIS EB SLOTS
        // --------------------------------------------------

        const checkoutId =
            crypto.randomUUID();


        const expiresAt =
            now +
            CHECKOUT_SECONDS * 1000;


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


        // --------------------------------------------------
        // 7. DISTRIBUTE MAIN HALL + VIP EB
        // --------------------------------------------------

        let mainHallEarlyBird = 0;

        let vipEarlyBird = 0;


        if (mainVipEarlyBird > 0) {

            if (mainHall === 0) {

                vipEarlyBird =
                    mainVipEarlyBird;

            }

            else if (vip === 0) {

                mainHallEarlyBird =
                    mainVipEarlyBird;

            }

            else {

                const totalMainVip =
                    mainHall +
                    vip;


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
                    Math.floor(
                        mainExact
                    );


                vipEarlyBird =
                    Math.floor(
                        vipExact
                    );


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

                    }

                    else {

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


        // --------------------------------------------------
        // 8. BUILD EXACT TICKET ALLOCATION
        // --------------------------------------------------

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

                type:
                    "mainhall",

                vip:
                    false,

                item:
                    MAIN_HALL_ITEM,

                early_bird:
                    earlyBird,

                variation:
                    earlyBird
                        ? MAIN_HALL_EB
                        : MAIN_HALL_REGULAR,

                price:
                    earlyBird
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

                type:
                    "mainhall",

                vip:
                    true,

                item:
                    MAIN_HALL_ITEM,

                early_bird:
                    earlyBird,

                variation:
                    earlyBird
                        ? VIP_EB
                        : VIP_REGULAR,

                price:
                    earlyBird
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

                type:
                    "watchparty",

                vip:
                    false,

                item:
                    WATCH_PARTY_ITEM,

                early_bird:
                    earlyBird,

                variation:
                    earlyBird
                        ? WATCH_PARTY_EB
                        : WATCH_PARTY_REGULAR,

                price:
                    earlyBird
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


        // --------------------------------------------------
        // 9. SAVE CHECKOUT SESSION
        // --------------------------------------------------

        const reservationKey =
            `tedx:checkout:${checkoutId}`;


        await redis.set(

            reservationKey,

            JSON.stringify({

                checkoutId,

                createdAt:
                    now,

                expiresAt,

                quantities: {

                    mainHall,

                    vip,

                    watchParty

                },

                tickets,

                totalTickets,

                totalPrice

            }),

            {
                ex:
                    CHECKOUT_SECONDS
            }

        );


        // --------------------------------------------------
        // 10. RETURN TO FRONTEND
        // --------------------------------------------------

        return sendJson(

            res,

            {

                success:
                    true,

                checkoutId,

                createdAt:
                    new Date(
                        now
                    ).toISOString(),

                expiresAt:
                    new Date(
                        expiresAt
                    ).toISOString(),

                expiresInSeconds:
                    CHECKOUT_SECONDS,

                tickets,

                totalTickets,

                totalPrice

            }

        );

    }

    catch (error) {

        console.error(
            "start-checkout error:",
            error
        );


        return sendJson(

            res,

            {

                success:
                    false,

                error:
                    error.message ||
                    "Something went wrong while starting checkout."

            },

            500

        );

    }

}
