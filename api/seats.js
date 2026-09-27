export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/seats/",
      {
        headers: {
          Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data,
      });
    }

    return res.status(200).json({
      success: true,
      count: data.count,
      seats: data.results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
