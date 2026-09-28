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


/*
 * --------------------------------------------------
 * COMPLETION CHECKS
 * --------------------------------------------------
 */

function hasTicketSelection() {

    try {

        const quantities =
            JSON.parse(
                localStorage.getItem(
                    "ticketQuantities"
                )
            );

        if (!quantities) {
            return false;
        }

        const total =
            Number(quantities.mainHall || 0) +
            Number(quantities.vip || 0) +
            Number(quantities.watchParty || 0);

        return total > 0;

    } catch {

        return false;

    }

}


function hasOrdererDetails() {

    try {

        const details =
            JSON.parse(
                localStorage.getItem(
                    "ordererDetails"
                )
            );

        if (!details) {
            return false;
        }

        return (
            String(details.fullName || "").trim() !== "" &&
            String(details.email || "").trim() !== "" &&
            String(details.phone || "").trim() !== ""
        );

    } catch {

        return false;

    }

}


function hasAttendees() {

    try {

        const attendees =
            JSON.parse(
                localStorage.getItem(
                    "attendees"
                )
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


function hasRequiredSeats() {

    try {

        const quantities =
            JSON.parse(
                localStorage.getItem(
                    "ticketQuantities"
                )
            );

        const selectedSeats =
            JSON.parse(
                localStorage.getItem(
                    "selectedSeats"
                )
            );

        if (!quantities || !selectedSeats) {
            return false;
        }


        const mainHallRequired =
            Number(quantities.mainHall || 0) +
            Number(quantities.vip || 0);

        const watchPartyRequired =
            Number(quantities.watchParty || 0);


        const selected =
            Object.values(selectedSeats)
                .filter(Boolean);


        const mainHallSelected =
            selected.filter(seat =>
                String(seat.id || "")
                    .startsWith("mainHall-")
            ).length;


        const watchPartySelected =
            selected.filter(seat =>
                String(seat.id || "")
                    .startsWith("watchParty-")
            ).length;


        return (
            mainHallSelected >= mainHallRequired &&
            watchPartySelected >= watchPartyRequired
        );

    } catch {

        return false;

    }

}


function hasAddons() {

    /*
     * Add-ons are optional.
     *
     * We therefore consider this step completed
     * when the user has reached/saved the add-ons step.
     */

    return (
        sessionStorage.getItem(
            "addonsCompleted"
        ) === "true"
    );

}


function hasReview() {

    return (
        sessionStorage.getItem(
            "reviewCompleted"
        ) === "true"
    );

}


function hasPayment() {

    return (
        sessionStorage.getItem(
            "paymentCompleted"
        ) === "true"
    );

}


/*
 * --------------------------------------------------
 * FIND FURTHEST COMPLETED PAGE
 * --------------------------------------------------
 */

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


    if (!hasRequiredSeats()) {

        return "seats";

    }


    if (
        Number(
            JSON.parse(
                localStorage.getItem(
                    "ticketQuantities"
                )
            )?.watchParty || 0
        ) > 0
    ) {

        /*
         * Watch Party attendees also need seats.
         */

        return "addons";

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


/*
 * --------------------------------------------------
 * PAGE ACCESS
 * --------------------------------------------------
 */

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
     * If the user hasn't reached this page,
     * send them to the furthest valid page.
     */

    if (
        currentIndex > furthestIndex
    ) {

        window.location.replace(
            TICKETING_PAGES[furthest]
        );

    }

}


/*
 * --------------------------------------------------
 * BACK BUTTON
 * --------------------------------------------------
 */

function addBackButton() {

    const currentPage =
        getCurrentPage();


    /*
     * No Back button on:
     * - Tickets
     * - Confirmation
     */

    if (
        !currentPage ||
        currentPage === "tickets" ||
        currentPage === "confirmation"
    ) {

        return;

    }


    /*
     * Determine the previous page.
     */

    const previousPages = {

        details: "tickets",

        attendees: "details",

        seats: "attendees",

        watchPartySeats: "seats",

        addons: "seats",

        review: "addons",

        payment: "review"

    };


    const previousPage =
        previousPages[currentPage];


    if (!previousPage) {
        return;
    }


    /*
     * Create the button.
     */

    const backButton =
        document.createElement(
            "button"
        );


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
     * Put the button before the page header.
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
     * Fallback:
     * insert before the first heading.
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


/*
 * --------------------------------------------------
 * INITIALISE
 * --------------------------------------------------
 */

(function() {

    protectPage();

    /*
     * Small delay so that a redirect happens
     * before the page visually builds.
     */

    setTimeout(
        addBackButton,
        0
    );

})();
