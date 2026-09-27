export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/cartpositions/",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cart_id: `variation-seat-test-${Date.now()}@api`,
          item: 1162153,
          variation: 1044379,
          price: "1000.00",
          seat: "2db9bc29-d78d-4d89-b0a4-65ffeb1b8975",
          expires: new Date(
            Date.now() + 15 * 60 * 1000
          ).toISOString(),
        }),
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      success: response.ok,
      status: response.status,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
