export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/quotas/6227773/?with_availability=true",
      {
        headers: {
          Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      success: response.ok,
      quota: {
        id: data.id,
        name: data.name,
        size: data.size,
        available: data.available,
        available_number: data.available_number,
        closed: data.closed,
        close_when_sold_out: data.close_when_sold_out,
        variations: data.variations,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
