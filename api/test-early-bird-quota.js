export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/quotas/6227773/availability/",
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
      quota: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
