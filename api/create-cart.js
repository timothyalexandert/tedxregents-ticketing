export default async function handler(req, res) {
  try {
    const cartId = `quota-test-${Date.now()}@api`;

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
          cart_id: cartId,
          item: 1162153,
          variation: 1044379,
          price: "40000.00",
          seat: "9f3da54a-fcc5-4d21-a9e6-47105140f695",
          expires: new Date(
            Date.now() + 15 * 60 * 1000
          ).toISOString(),
        }),
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      success: response.ok,
      cart_id: cartId,
      result: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
