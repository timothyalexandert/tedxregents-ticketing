export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/cartpositions/?limit=100",
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

    const positions = data.results || [];

    const earlyBirds = positions.filter(
      (position) =>
        position.item === 1162153 &&
        (position.variation === 1044379 ||
          position.variation === 1044381)
    );

    return res.status(200).json({
      success: true,
      total_cart_positions: positions.length,
      early_bird_cart_positions: earlyBirds.length,
      early_bird_positions: earlyBirds,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
