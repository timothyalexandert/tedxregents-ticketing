export default async function handler(req, res) {
  const items = [
    { name: "Main Hall Early Bird", id: 1161768 },
    { name: "Main Hall", id: 1161769 },
    { name: "VIP Early Bird", id: 1161772 },
    { name: "VIP", id: 1161773 },
  ];

  try {
    const results = [];

    for (const item of items) {
      const response = await fetch(
        `https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027/items/${item.id}/`,
        {
          headers: {
            Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
            Accept: "application/json",
          },
        }
      );

      const data = await response.json();

      results.push({
        name: item.name,
        status: response.status,
        data,
      });
    }

    return res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
