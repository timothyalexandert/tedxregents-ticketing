import { Redis } from "@upstash/redis";

const PRETIX_BASE =
    "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

const MAX_TICKETS_PER_ORDER = 10;


/* =========================================
   GET REDIS
   ========================================= */

function getRedis() {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
        throw new Error(
            "Redis environment variables are missing. Please check KV_REST_API_URL and KV_REST_API_TOKEN in Vercel."
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
    const token = process.env.PRETIX_API_TOKEN;

    if (!token) {
        throw new Error(
            "PRETIX_API_TOKEN is missing from Vercel environment variables."
        );
    }

    return token;
}


/* =========================================
   LOAD TICKET INFORMATION
   ========================================= */

async function loadTicketInformation(
    orderCode,
    expectedTicketCount
) {
    const pretixToken = getPretixToken();

    const url =
        PRETIX_BASE +
        "/orderpositions/?order=" +
        encodeURIComponent(orderCode);

    const response = await fetch(url, {
        method: "GET",

        headers: {
            Authorization:
                "Token " + pretixToken,

            Accept:
                "application/json"
        }
    });

    const responseText =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(responseText);
    } catch {
        data =
            responseText;
    }

    if (!response.ok) {
        console.error(
            "Pretix order positions request failed:",
            data
        );

        throw new Error(
            "Pretix could not return the ticket information."
        );
    }

    const results =
        Array.isArray(data.results)
            ? data.results
            : [];

    const ticketPositions =
        results.filter(function (position) {
            return position.addon_to == null;
        });

    if (
        ticketPositions.length !==
        expectedTicketCount
    ) {
        console.error(
            "Unexpected ticket position count:",
            {
                expected:
                    expectedTicketCount,

                received:
                    ticketPositions.length,

                positions:
                    results
            }
        );

        throw new Error(
            "The order was created, but the ticket information is incomplete."
        );
    }

    return ticketPositions.map(
        function (position) {
            return {
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
                    position.seat
            };
        }
    );
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
           INITIALISE SERVICES
           ===================================== */

        const redis =
            getRedis();

        const pretixToken =
            getPretixToken();


        /* =====================================
           REQUEST BODY
           ===================================== */

        const body =
            req.body;

        if (
            !body ||
            typeof body !== "object"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid request body."
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
           CHECKOUT ID
           ===================================== */

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
           LOAD CHECKOUT
           ===================================== */

        const checkout =
            await redis.get(
                "tedx:checkout:" +
                checkoutId
            );

        if (!checkout) {
            return res.status(400).json({
                success: false,
                error:
                    "Your checkout has expired. Please start again."
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
                    "Invalid ticket reservation."
            });
        }


        /* =====================================
           LOAD CART
           ===================================== */

        const savedCart =
            await redis.get(
                "tedx:cart:" +
                checkoutId
            );

        if (!savedCart) {
            return res.status(400).json({
                success: false,
                error:
                    "Your seat reservation has expired. Please select your seats again."
            });
        }


        if (
            cartId &&
            savedCart.cartId !== cartId
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid ticket reservation."
            });
        }


        /* =====================================
           CHECK FOR EXISTING ORDER
           ===================================== */

        const existingOrder =
            await redis.get(
                "tedx:order:" +
                checkoutId
            );


        if (existingOrder) {

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
                        existingOrder
                });
            }


            const ticketInformation =
                await loadTicketInformation(
                    existingOrder.orderCode,
                    tickets.length
                );


            const updatedOrder = {
                ...existingOrder,

                tickets:
                    ticketInformation
            };


            await redis.set(
                "tedx:order:" +
                checkoutId,

                updatedOrder
            );


            return res.status(200).json({
                success: true,
                existing: true,
                order:
                    updatedOrder
            });
        }


        /* =====================================
           VALIDATE ORDERER
           ===================================== */

        if (
            !ordererDetails ||
            typeof ordererDetails !== "object"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Orderer details are required."
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
                    "Name, email and phone are required."
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
                    "The number of attendees does not match the number of tickets."
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
                        "Every attendee must have a name, email and phone number."
                });
            }
        }


        /* =====================================
           PAYMENT METHOD
           ===================================== */

        if (
            paymentMethod !== "cash" &&
            paymentMethod !== "bank"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid payment method."
            });
        }


        if (
            paymentMethod === "bank" &&
            !paymentProofName
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Bank transfer payment proof is required."
            });
        }


        /* =====================================
           ADD-ONS
           ===================================== */

        const ADDONS = [
            {
                key:
                    "toteBag",

                item:
                    1162126,

                price:
                    60000
            },

            {
                key:
                    "notebook",

                item:
                    1162127,

                price:
                    30000
            },

            {
                key:
                    "pen",

                item:
                    1162128,

                price:
                    10000
            },

            {
                key:
                    "lanyard",

                item:
                    1162129,

                price:
                    15000
            },

            {
                key:
                    "stickerPack",

                item:
                    1162130,

                price:
                    3000
            },

            {
                key:
                    "food",

                item:
                    1162131,

                price:
                    30000
            }
        ];


        /* =====================================
           BUILD POSITIONS
           ===================================== */

        const positions = [];

        let positionId = 1;


        /*
         * Pretix requires add-ons to appear
         * immediately after the position they
         * reference.
         *
         * We attach all order-level add-ons
         * to the first ticket.
         */

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
                savedCart.seats &&
                savedCart.seats[index];


            if (
                !savedSeat ||
                !savedSeat.seatGuid
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "A reserved seat could not be found."
                });
            }


            const currentPositionId =
                positionId;


            /* =================================
               TICKET POSITION
               ================================= */

            positions.push({
                positionid:
                    currentPositionId,

                item:
                    Number(
                        ticket.item
                    ),

                variation:
                    Number(
                        ticket.variation
                    ),

                price:
                    String(
                        ticket.price
                    ),

                seat:
                    savedSeat.seatGuid,

                attendee_name:
                    String(
                        attendee.name
                    ).trim(),

                attendee_email:
                    String(
                        attendee.email
                    ).trim()
            });


            positionId++;


            /* =================================
               ADD-ONS
               ================================= */

            if (
                index === 0 &&
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
                        !Number.isInteger(
                            quantity
                        ) ||
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
                                "Invalid quantity for " +
                                addon.key +
                                "."
                        });
                    }


                    /*
                     * Each add-on unit gets its
                     * own position.
                     *
                     * Pretix does not use a "count"
                     * field here.
                     */

                    for (
                        let quantityIndex = 0;
                        quantityIndex < quantity;
                        quantityIndex++
                    ) {

                        positions.push({
                            positionid:
                                positionId,

                            item:
                                addon.item,

                            price:
                                String(
                                    addon.price
                                ),

                            addon_to:
                                currentPositionId
                        });


                        positionId++;
                    }
                }
            }
        }


        /* =====================================
           PAYMENT INFORMATION
           ===================================== */

        const paymentInfo = {
            method:
                paymentMethod,

            proof_name:
                paymentProofName || null,

            status:
                "pending"
        };


        /* =====================================
           PRETIX ORDER PAYLOAD
           ===================================== */

        const orderPayload = {

            email:
                ordererEmail,

            payment_provider:
                "manual",

            payment_info:
                paymentInfo,

            comment:
                "Orderer: " +
                ordererName,

            api_meta:
                JSON.stringify({
                    checkout_id:
                        checkoutId,

                    payment_method:
                        paymentMethod,

                    payment_proof_name:
                        paymentProofName || null
                }),

            positions:
                positions,

            consume_carts: [
                savedCart.cartId
            ]
        };


        /* =====================================
           CREATE PRETIX ORDER
           ===================================== */

        const pretixResponse =
            await fetch(
                PRETIX_BASE +
                "/orders/",
                {
                    method:
                        "POST",

                    headers: {

                        Authorization:
                            "Token " +
                            pretixToken,

                        Accept:
                            "application/json",

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            orderPayload
                        )
                }
            );


        const pretixResponseText =
            await pretixResponse.text();


        let pretixData;


        try {
            pretixData =
                JSON.parse(
                    pretixResponseText
                );
        } catch {
            pretixData =
                pretixResponseText;
        }


        /* =====================================
           CHECK PRETIX RESPONSE
           ===================================== */

        if (
            !pretixResponse.ok
        ) {

            console.error(
                "Pretix order creation failed:",
                pretixData
            );


            return res.status(502).json({
                success: false,
                error:
                    "Pretix rejected the order.",

                pretix:
                    pretixData,

                details:
                    pretixData
            });
        }


        if (
            !pretixData ||
            !pretixData.code
        ) {

            console.error(
                "Pretix returned an unexpected response:",
                pretixData
            );


            return res.status(502).json({
                success: false,

                error:
                    "Pretix created an unexpected response without an order code.",

                pretix:
                    pretixData
            });
        }


        /* =====================================
           LOAD TICKET INFORMATION
           ===================================== */

        const ticketInformation =
            await loadTicketInformation(
                pretixData.code,
                tickets.length
            );


        /* =====================================
           SAVE ORDER
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
                new Date().toISOString()
        };


        await redis.set(
            "tedx:order:" +
            checkoutId,

            orderRecord
        );


        /* =====================================
           SUCCESS
           ===================================== */

        return res.status(201).json({
            success: true,

            order:
                orderRecord
        });


    } catch (error) {

        console.error(
            "CREATE ORDER FUNCTION ERROR:",
            error
        );


        return res.status(500).json({
            success: false,

            error:
                error &&
                error.message
                    ? error.message
                    : "An unexpected server error occurred."
        });

    }

}
