import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});


const PRETIX_BASE =
    "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";


const ADDONS = {
    toteBag: {
        item: 1162126,
        price: 60000,
        name: "Tote Bag"
    },

    notebook: {
        item: 1162127,
        price: 30000,
        name: "Notebook"
    },

    pen: {
        item: 1162128,
        price: 10000,
        name: "Pen"
    },

    lanyard: {
        item: 1162129,
        price: 15000,
        name: "Lanyard"
    },

    stickerPack: {
        item: 1162130,
        price: 3000,
        name: "Sticker Pack"
    },

    food: {
        item: 1162131,
        price: 30000,
        name: "Food"
    }
};


function cleanString(value) {

    return String(value || "").trim();

}


function getCheckoutKey(checkoutId) {

    return `tedx:checkout:${checkoutId}`;

}


function getOrderKey(checkoutId) {

    return `tedx:order:${checkoutId}`;

}


async function getPretixOrder(
    orderCode
) {

    const response =
        await fetch(
            `${PRETIX_BASE}/orders/${encodeURIComponent(orderCode)}/`,
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
            "Could not retrieve the Pretix order."
        );

    }


    return data;

}


export default async function handler(req, res) {

    if (req.method !== "POST") {

        return res.status(405).json({
            success: false,
            error: "Method not allowed. Use POST."
        });

    }


    try {

        const {
            checkoutId,
            paymentMethod,
            paymentProofName
        } = req.body || {};


        /* =====================================
           BASIC VALIDATION
           ===================================== */

        if (!checkoutId) {

            return res.status(400).json({
                success: false,
                error: "Missing checkout ID."
            });

        }


        if (
            paymentMethod !== "cash" &&
            paymentMethod !== "bank"
        ) {

            return res.status(400).json({
                success: false,
                error: "Invalid payment method."
            });

        }


        /* =====================================
           GET SAVED CHECKOUT
           ===================================== */

        const checkout =
            await redis.get(
                getCheckoutKey(checkoutId)
            );


        if (!checkout) {

            return res.status(400).json({
                success: false,
                error:
                    "Your checkout has expired. Please start again."
            });

        }


        /* =====================================
           PREVENT DUPLICATE ORDER CREATION
           ===================================== */

        const existingOrder =
            await redis.get(
                getOrderKey(checkoutId)
            );


        if (existingOrder?.orderCode) {

            const order =
                await getPretixOrder(
                    existingOrder.orderCode
                );


            return res.status(200).json({
                success: true,
                alreadyCreated: true,
                order
            });

        }


        /* =====================================
           GET ORDERER
           ===================================== */

        const orderer =
            checkout.orderer ||
            null;


        /*
         * The orderer is normally stored on
         * the frontend, so we also accept it
         * from the request if needed later.
         *
         * For now the actual customer email
         * will be taken from the frontend data
         * below.
         */


        /* =====================================
           GET REQUEST DATA
           ===================================== */

        const {
            ordererDetails,
            attendees,
            selectedSeats,
            addons
        } = req.body || {};


        if (!ordererDetails) {

            return res.status(400).json({
                success: false,
                error: "Orderer details are missing."
            });

        }


        const ordererName =
            cleanString(
                ordererDetails.name
            );

        const ordererEmail =
            cleanString(
                ordererDetails.email
            );

        const ordererPhone =
            cleanString(
                ordererDetails.phone
            );


        if (
            !ordererName ||
            !ordererEmail ||
            !ordererPhone
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Complete orderer details are required."
            });

        }


        /* =====================================
           VALIDATE ATTENDEES
           ===================================== */

        if (
            !Array.isArray(attendees) ||
            attendees.length === 0
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Attendee information is missing."
            });

        }


        const expectedTicketCount =
            Array.isArray(checkout.tickets)
                ? checkout.tickets.length
                : 0;


        if (
            attendees.length !==
            expectedTicketCount
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Attendee count does not match the ticket count."
            });

        }


        const cleanAttendees =
            attendees.map(
                attendee => ({
                    name:
                        cleanString(
                            attendee.name
                        ),

                    email:
                        cleanString(
                            attendee.email
                        ),

                    phone:
                        cleanString(
                            attendee.phone
                        )
                })
            );


        const invalidAttendee =
            cleanAttendees.find(
                attendee =>
                    !attendee.name ||
                    !attendee.email ||
                    !attendee.phone
            );


        if (invalidAttendee) {

            return res.status(400).json({
                success: false,
                error:
                    "Every attendee must have a name, email and phone number."
            });

        }


        /* =====================================
           VALIDATE SEATS
           ===================================== */

        if (
            !selectedSeats ||
            typeof selectedSeats !== "object"
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Seat information is missing."
            });

        }


        const seatByAttendee =
            {};


        for (
            let i = 0;
            i < cleanAttendees.length;
            i++
        ) {

            const attendeeNumber =
                String(i + 1);

            const seat =
                selectedSeats[
                    attendeeNumber
                ];


            if (!seat?.id) {

                return res.status(400).json({
                    success: false,
                    error:
                        `Seat is missing for attendee ${i + 1}.`
                });

            }


            seatByAttendee[
                attendeeNumber
            ] = seat;

        }


        /* =====================================
           VALIDATE ADD-ONS
           ===================================== */

        const cleanAddons =
            addons &&
            typeof addons === "object"
                ? addons
                : {};


        const addonPositions =
            [];


        /* =====================================
           BUILD TICKET POSITIONS
           ===================================== */

        const positions =
            [];


        let positionId = 1;


        checkout.tickets.forEach(
            (ticket, index) => {

                const attendee =
                    cleanAttendees[index];


                const seat =
                    seatByAttendee[
                        String(index + 1)
                    ];


                /*
                 * The temporary seat ID is
                 * already resolved by create-cart,
                 * so we need the actual Pretix
                 * seat GUID.
                 *
                 * create-cart stores this in
                 * pretixCart.
                 */

                positions.push({

                    positionid:
                        positionId,

                    item:
                        Number(ticket.item),

                    variation:
                        ticket.variation
                            ? Number(ticket.variation)
                            : null,

                    price:
                        String(ticket.price),

                    seat:
                        seat.seatGuid ||
                        seat.seat_guid ||
                        null,

                    attendee_name:
                        attendee.name,

                    attendee_email:
                        attendee.email,

                    addon_to:
                        null

                });


                positionId++;

            }
        );


        /* =====================================
           GET CART
           ===================================== */

        const cartData =
            await redis.get(
                `tedx:cart:${checkoutId}`
            );


        /*
         * The frontend also keeps the cart
         * information in sessionStorage.
         *
         * We use the request's cart ID below
         * if supplied.
         */


        const cartId =
            req.body.cartId ||
            cartData?.cart_id ||
            cartData?.cartId ||
            null;


        if (!cartId) {

            return res.status(400).json({
                success: false,
                error:
                    "Pretix cart could not be found. Please return to seating and try again."
            });

        }


        /* =====================================
           ADD-ONS
           ===================================== */

        /*
         * Add-ons are attached to the first
         * ticket position.
         *
         * Pretix requires add-on positions
         * to immediately follow their parent.
         *
         * We therefore rebuild the position list
         * with add-ons immediately after the
         * first ticket.
         */

        const ticketPositions =
            positions.slice();


        const firstTicket =
            ticketPositions[0];


        const firstTicketId =
            firstTicket.positionid;


        const finalPositions =
            [];


        let nextPositionId = 1;


        ticketPositions.forEach(
            (ticketPosition, ticketIndex) => {

                const newTicketPosition =
                    {
                        ...ticketPosition,

                        positionid:
                            nextPositionId
                    };


                finalPositions.push(
                    newTicketPosition
                );


                const originalIndex =
                    ticketIndex;


                /*
                 * Add-ons are attached to the
                 * first ticket only.
                 */

                if (
                    originalIndex === 0
                ) {

                    Object.entries(
                        ADDONS
                    ).forEach(
                        ([
                            key,
                            addon
                        ]) => {

                            const quantity =
                                Number(
                                    cleanAddons[key]
                                ) || 0;


                            if (
                                quantity <= 0
                            ) {
                                return;
                            }


                            for (
                                let i = 0;
                                i < quantity;
                                i++
                            ) {

                                nextPositionId++;


                                finalPositions.push({

                                    positionid:
                                        nextPositionId,

                                    item:
                                        addon.item,

                                    variation:
                                        null,

                                    price:
                                        String(
                                            addon.price
                                        ),

                                    seat:
                                        null,

                                    attendee_name:
                                        cleanAttendees[0]
                                            .name,

                                    attendee_email:
                                        cleanAttendees[0]
                                            .email,

                                    addon_to:
                                        newTicketPosition
                                            .positionid

                                });

                            }

                        }
                    );

                }


                nextPositionId++;

            }
        );


        /* =====================================
           CREATE ORDER
           ===================================== */

        const orderPayload = {

            status:
                "n",

            email:
                ordererEmail,

            locale:
                "en",

            sales_channel:
                "web",

            payment_provider:
                "manual",

            payment_info: {

                method:
                    paymentMethod,

                payment_proof_name:
                    paymentProofName || null

            },

            phone:
                ordererPhone,

            comment:
                `Orderer: ${ordererName}`,

            api_meta: {

                source:
                    "TEDxRegents Secondary School Bali YOUTH custom checkout",

                orderer_name:
                    ordererName,

                payment_method:
                    paymentMethod,

                payment_proof_name:
                    paymentProofName || null

            },

            consume_carts: [
                cartId
            ],

            positions:
                finalPositions

        };


        const response =
            await fetch(
                `${PRETIX_BASE}/orders/`,
                {
                    method:
                        "POST",

                    headers: {

                        Authorization:
                            `Token ${process.env.PRETIX_API_TOKEN}`,

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


        const data =
            await response.json();


        if (!response.ok) {

            console.error(
                "Pretix order creation failed:",
                data
            );


            return res.status(
                response.status
            ).json({

                success:
                    false,

                error:
                    data?.detail ||
                    data?.non_field_errors?.[0] ||
                    "Pretix could not create the order.",

                pretix:
                    data

            });

        }


        /* =====================================
           SAVE ORDER
           ===================================== */

        await redis.set(
            getOrderKey(checkoutId),
            {
                orderCode:
                    data.code,

                orderSecret:
                    data.secret,

                createdAt:
                    new Date().toISOString()

            },
            {
                ex:
                    60 * 60 * 24 * 30
            }
        );


        /* =====================================
           RETURN ORDER
           ===================================== */

        return res.status(201).json({

            success:
                true,

            order:
                data

        });


    } catch (error) {

        console.error(
            "Create order error:",
            error
        );


        return res.status(500).json({

            success:
                false,

            error:
                error.message ||
                "Could not create your order."

        });

    }

}
