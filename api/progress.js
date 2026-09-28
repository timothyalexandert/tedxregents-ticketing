const TICKETING_PAGES = {
    tickets: "index.html",
    details: "details.html",
    attendees: "attendees.html",
    seats: "seats.html",
    watchPartySeats: "watch-party-seats.html",
    addons: "add-ons.html",
    review: "review.html",
    payment: "payment.html",
    confirmation: "confirmation.html"
};


/* =========================================
   HELPERS
   ========================================= */

function getTicketQuantities() {

    try {

        return JSON.parse(
            localStorage.getItem("ticketQuantities")
        ) || {
            mainHall: 0,
            vip: 0,
            watchParty: 0
        };

    } catch {

        return {
            mainHall: 0,
            vip: 0,
            watchParty: 0
        };

    }

}


/* =========================================
   CHECK TICKETS
   ========================================= */

function hasTicketSelection() {

    const quantities =
        getTicketQuantities();

    const total =
        Number(quantities.mainHall || 0) +
        Number(quantities.vip || 0) +
        Number(quantities.watchParty || 0);

    return total > 0;

}


/* =========================================
   CHECK DETAILS
   ========================================= */

function hasOrdererDetails() {

    try {

        const details =
            JSON.parse(
                localStorage.getItem("ordererDetails")
            );

        if (!details) {
            return false;
        }

        return (
            String(details.name || "").trim() !== "" &&
            String(details.email || "").trim() !== "" &&
            String(details.phone || "").trim() !== ""
        );

    } catch {

        return false;

    }

}


/* =========================================
   CHECK ATTENDEES
   ========================================= */

function hasAttendees() {

    try {

        const attendees =
            JSON.parse(
                localStorage.getItem("attendees")
            );

        if (!Array.isArray(attendees)) {
            return false;
        }

        if (attendees.length === 0) {
            return false;
        }

        return attendees.every(attendee => {

            return (
                String(attendee.name || "").trim() !== "" &&
                String(attendee.email || "").trim() !== "" &&
                String(attendee.phone || "").trim() !== ""
            );

        });

    } catch {

        return false;

    }

}


/* =========================================
   CHECK MAIN HALL / VIP SEATS
   ========================================= */

function hasMainHallSeats() {

    try {

        const quantities =
            getTicketQuantities();

        const selectedSeats =
            JSON.parse(
                localStorage.getItem("selectedSeats")
            ) || {};


        const required =
            Number(quantities.mainHall || 0) +
            Number(quantities.vip || 0);


        if (required === 0) {
            return true;
        }


        let selected = 0;


        for (let i = 1; i <= 100; i++) {

            const seat =
                selectedSeats[String(i)];

            if (
                seat &&
                String(seat.id || "")
                    .startsWith("mainHall-")
            ) {

                selected++;

            }

        }


        return selected >= required;

    } catch {

        return false;

    }

}


/* =========================================
   CHECK WATCH PARTY SEATS
   ========================================= */

function hasWatchPartySeats() {

    try {

        const quantities =
            getTicketQuantities();

        const required =
            Number(
                quantities.watchParty || 0
            );


        if (required === 0) {
            return true;
        }


        const selectedSeats =
            JSON.parse(
                localStorage.getItem("selectedSeats")
            ) || {};


        let selected = 0;


        for (let i = 1; i <= 100; i++) {

            const seat =
                selectedSeats[String(i)];


            if (
                seat &&
                String(seat.id || "")
                    .startsWith("watchParty-")
            ) {

                selected++;

            }

        }


        return selected >= required;

    } catch {

        return false;

    }

}


/* =========================================
   CHECK ADD-ONS
   ========================================= */

function hasAddons() {

    return (
        sessionStorage.getItem(
            "addonsCompleted"
        ) === "true"
    );

}


/* =========================================
   CHECK REVIEW
   ========================================= */

function hasReview() {

    return (
        sessionStorage.getItem(
            "reviewCompleted"
        ) === "true"
    );

}


/* =========================================
   CHECK PAYMENT
   ========================================= */

function hasPayment() {

    return (
        sessionStorage.getItem(
            "paymentCompleted"
        ) === "true"
    );

}


/* =========================================
   FIND FURTHEST VALID PAGE
   ========================================= */

function getFurthestCompletedPage() {

    if (!hasTicketSelection()) {
        return "tickets";
    }


    if (!hasOrdererDetails()) {
        return "details";
    }


    if (!hasAttendees()) {
        return "attendees";
    }


    if (!hasMainHallSeats()) {
        return "seats";
    }


    const quantities =
        getTicketQuantities();


    if (
        Number(quantities.watchParty || 0) > 0 &&
        !hasWatchPartySeats()
    ) {

        return "watchPartySeats";

    }


    if (!hasAddons()) {
        return "addons";
    }


    if (!hasReview()) {
        return "review";
    }


    if (!hasPayment()) {
        return "payment";
    }


    return "confirmation";

}


/* =========================================
   FIND CURRENT PAGE
   ========================================= */

function getCurrentPage() {

    const path =
        window.location.pathname
            .split("/")
            .pop()
            .toLowerCase();


    if (
        path === "" ||
        path === "index.html"
    ) {

        return "tickets";

    }


    for (
        const [key, file]
        of Object.entries(TICKETING_PAGES)
    ) {

        if (
            file.toLowerCase() === path
        ) {

            return key;

        }

    }


    return null;

}


/* =========================================
   PROTECT PAGE
   ========================================= */

function protectPage() {

    const currentPage =
        getCurrentPage();


    if (!currentPage) {
        return;
    }


    /*
     * Tickets is always accessible.
     */

    if (
        currentPage === "tickets"
    ) {

        return;

    }


    const furthest =
        getFurthestCompletedPage();


    const pageOrder = [
        "tickets",
        "details",
        "attendees",
        "seats",
        "watchPartySeats",
        "addons",
        "review",
        "payment",
        "confirmation"
    ];


    const currentIndex =
        pageOrder.indexOf(
            currentPage
        );


    const furthestIndex =
        pageOrder.indexOf(
            furthest
        );


    /*
     * Don't allow users to jump ahead.
     */

    if (
        currentIndex > furthestIndex
    ) {

        window.location.replace(
            TICKETING_PAGES[furthest]
        );

    }

}


/* =========================================
   BACK BUTTON
   ========================================= */

function addBackButton() {

    const currentPage =
        getCurrentPage();


    /*
     * No Back button on:
     * Tickets
     * Confirmation
     */

    if (
        !currentPage ||
        currentPage === "tickets" ||
        currentPage === "confirmation"
    ) {

        return;

    }


    const quantities =
        getTicketQuantities();


    let previousPage;


    switch (currentPage) {

        case "details":

            previousPage =
                "tickets";

            break;


        case "attendees":

            previousPage =
                "details";

            break;


        case "seats":

            previousPage =
                "attendees";

            break;


        case "watchPartySeats":

            previousPage =
                "seats";

            break;


        case "addons":

            /*
             * If Watch Party tickets exist,
             * their seating page is the actual
             * previous step.
             */

            if (
                Number(
                    quantities.watchParty || 0
                ) > 0
            ) {

                previousPage =
                    "watchPartySeats";

            } else {

                previousPage =
                    "seats";

            }

            break;


        case "review":

            previousPage =
                "addons";

            break;


        case "payment":

            previousPage =
                "review";

            break;


        default:

            return;

    }


    const backButton =
        document.createElement("button");


    backButton.type =
        "button";


    backButton.textContent =
        "← Back";


    backButton.style.background =
        "none";

    backButton.style.border =
        "none";

    backButton.style.padding =
        "0";

    backButton.style.margin =
        "0 0 18px 0";

    backButton.style.font =
        "inherit";

    backButton.style.fontSize =
        "14px";

    backButton.style.color =
        "#777";

    backButton.style.textDecoration =
        "underline";

    backButton.style.cursor =
        "pointer";


    backButton.addEventListener(
        "click",
        function() {

            window.location.href =
                TICKETING_PAGES[
                    previousPage
                ];

        }
    );


    /*
     * Put Back immediately before header.
     */

    const header =
        document.querySelector(
            "header"
        );


    if (header) {

        header.parentNode.insertBefore(
            backButton,
            header
        );

        return;

    }


    /*
     * Fallback.
     */

    const heading =
        document.querySelector(
            "h1, h2"
        );


    if (heading) {

        heading.parentNode.insertBefore(
            backButton,
            heading
        );

    }

}


/* =========================================
   INITIALISE
   ========================================= */

(function() {

    protectPage();

    setTimeout(
        addBackButton,
        0
    );

})();
