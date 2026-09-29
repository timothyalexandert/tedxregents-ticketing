import { Redis } from "@upstash/redis";

const PRETIX_BASE =
    "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";


/* =========================================
   GET REDIS
   ========================================= */

function getRedis() {

    const url =
        process.env.KV_REST_API_URL;

    const token =
        process.env.KV_REST_API_TOKEN;


    if (!url || !token) {

        throw new Error(
            "Redis environment variables are missing."
        );

    }


    return new Redis({
        url: url,
        token: token
    });

}


/* =========================================
   GET PRETIX TOKEN
   ========================================= */

function getPretixToken() {

    const token =
        process.env.PRETIX_API_TOKEN;


    if (!token) {

        throw new Error(
            "PRETIX_API_TOKEN is missing."
        );

    }


    return token;

}


/* =========================================
   MAIN HANDLER
   ========================================= */

export default async function handler(
    req,
    res
) {

    try {

        /* =====================================
           METHOD
           ===================================== */

        if (
            req.method !== "POST"
        ) {

            return res.status(405).json({
                success: false,
                error:
                    "Method not allowed. Use POST."
            });

        }


        /* =====================================
           SERVICES
           ===================================== */

        const redis =
            getRedis();

        const pretixToken =
            getPretixToken();


        /* =====================================
           REQUEST
           ===================================== */

        const body =
            req.body;


        const checkoutId =
            body &&
            body.checkoutId;


        if (
            typeof checkoutId !== "string" ||
            !checkoutId.trim()
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "checkoutId is required."
            });

        }


        /* =====================================
           LOAD SAVED CART
           ===================================== */

        const cartKey =
            "tedx:cart:" +
            checkoutId;


        const savedCart =
            await redis.get(
                cartKey
            );


        if (!savedCart) {

            return res.status(200).json({
                success: true,
                released: false,
                message:
                    "No active cart was found."
            });

        }


        /* =====================================
           GET CART POSITIONS
           ===================================== */

        const positions =
            Array.isArray(
                savedCart.positions
            )
                ? savedCart.positions
                : [];


        const results = [];


        /* =====================================
           DELETE PRETIX CART POSITIONS
           ===================================== */

        for (
            const position
            of positions
        ) {

            const positionId =
                position &&
                (
                    position.id ||
                    position.positionid
                );


            if (!positionId) {
                continue;
            }


            const response =
                await fetch(
                    PRETIX_BASE +
                    "/cartpositions/" +
                    encodeURIComponent(
                        positionId
                    ) +
                    "/",
                    {
                        method:
                            "DELETE",

                        headers: {
                            Authorization:
                                "Token " +
                                pretixToken,

                            Accept:
                                "application/json"
                        }
                    }
                );


            if (
                response.ok ||
                response.status === 404
            ) {

                results.push({
                    id:
                        positionId,

                    released:
                        true
                });

            } else {

                const responseText =
                    await response.text();


                console.error(
                    "Could not release Pretix cart position:",
                    {
                        positionId:
                            positionId,

                        status:
                            response.status,

                        response:
                            responseText
                    }
                );


                results.push({
                    id:
                        positionId,

                    released:
                        false
                });

            }

        }


        /* =====================================
           DELETE LOCAL CART
           ===================================== */

        await redis.del(
            cartKey
        );


        /* =====================================
           SUCCESS
           ===================================== */

        return res.status(200).json({

            success:
                true,

            released:
                true,

            positions:
                results

        });


    } catch (error) {

        console.error(
            "RELEASE CART ERROR:",
            error
        );


        return res.status(500).json({

            success:
                false,

            error:
                error &&
                error.message
                    ? error.message
                    : "Could not release the seat reservation."

        });

    }

}
