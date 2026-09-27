export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

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
          cart_id: `test-${Date.now()}@api`,
          item: 1161768,
          variation: null,
          price: "40000.00",
          seat: "e1f3d828-2bb8-49e6-8eb7-296004b1aa82",
          expires: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
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
      message: "Main Hall seat successfully reserved!",
      cart: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
