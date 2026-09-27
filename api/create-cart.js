export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  const tests = [
    {
      name: "Main Hall Early Bird",
      item: 1161768,
      price: "40000.00",
      seat: "9f3da54a-fcc5-4d21-a9e6-47105140f695", // Row 1 Seat 2
    },
    {
      name: "Main Hall Normal",
      item: 1161769,
      price: "45000.00",
      seat: "2db9bc29-d78d-4d89-b0a4-65ffeb1b8975", // Row 1 Seat 3
    },
    {
      name: "VIP Early Bird",
      item: 1161772,
      price: "50000.00",
      seat: "4eb07895-3368-4a19-9faf-566300e20681", // Row 1 Seat 4
    },
    {
      name: "VIP Normal",
      item: 1161773,
      price: "55000.00",
      seat: "1ad7c9a4-f829-4fe2-995b-7cebde472989", // Row 1 Seat 5
    },
  ];

  const results = [];

  try {
    for (const test of tests) {
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
            cart_id: `seat-test-${Date.now()}-${test.item}@api`,
            item: test.item,
            variation: null,
            price: test.price,
            seat: test.seat,
            expires: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          }),
        }
      );

      const data = await response.json();

      results.push({
        ticket: test.name,
        success: response.ok,
        status: response.status,
        data,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Main Hall ticket compatibility test completed.",
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
