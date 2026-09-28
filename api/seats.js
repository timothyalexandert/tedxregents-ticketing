const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

const ZONES = [
  "Main Hall",
  "Watch Party"
];

export default async function handler(req, res) {

  if (req.method !== "GET") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use GET."
    });

  }

  try {

    const headers = {
      Authorization:
        `Token ${process.env.PRETIX_API_TOKEN}`,

      Accept:
        "application/json"
    };


    const getSeats = async (zoneName) => {

      const response =
        await fetch(
          `${PRETIX_BASE}/seats/?zone_name=${encodeURIComponent(zoneName)}`,
          { headers }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data?.detail ||
          `Could not load ${zoneName} seats.`
        );

      }


      return data.results || [];

    };


    const [
      mainHallSeats,
      watchPartySeats
    ] = await Promise.all([
      getSeats("Main Hall"),
      getSeats("Watch Party")
    ]);


    return res.status(200).json({

      success: true,

      mainHall:
        mainHallSeats,

      watchParty:
        watchPartySeats

    });

  } catch (error) {

    console.error(
      "Seats error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Could not load seats."

    });

  }

}
