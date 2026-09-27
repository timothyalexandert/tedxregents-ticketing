export default async function handler(req, res) {
  try {
    const cartId = `quota-test-${Date.now()}@api`;

    const payload = {
      cart_id: cartId,
      item: 1162153,
      variation: 1044381,
      price: "50000.00",
      seat: "e1f3d828-2bb8-49e6-8eb7-296004b1aa82",
      expires: new Date(
        Date.now() + 15 * 60 * 1000
      ).toISOString(),
    };

    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/cartpositions/",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return res.status(200).json({
      pretix_status: response.status,
      pretix_success: response.ok,
      cart_id: cartId,
      payload_sent: payload,
      pretix_response: data,
    });
  } catch (error) {
    return res.status(200).json({
      pretix_success: false,
      error: error.message,
      stack: error.stack,
    });
  }
}
