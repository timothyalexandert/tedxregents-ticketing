const ticketOptions = document.querySelectorAll(".ticket-card button");

ticketOptions.forEach((button) => {
    button.addEventListener("click", () => {
        const ticketCard = button.closest(".ticket-card");
        const ticketType = ticketCard.querySelector("h3").textContent;

        localStorage.setItem("ticketType", ticketType);

        window.location.href = "tickets.html";
    });
});
