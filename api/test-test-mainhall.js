export default async function handler(req, res) {
  const tests = [
    {
      name: "Main Hall EB",
      variation: 1044379,
      price: "40000.00",
      seat: "9f3da54a-fcc5-4d21-a9e6-47105140f695",
    },
    {
      name: "Main Hall Normal",
      variation: 1044380,
      price: "45000.00",
      seat: "2db9bc29-d78d-4d89-b0a4-65ffeb1b8975",
    },
    {
      name: "VIP EB",
      variation: 1044381,
      price: "50000.00",
      seat: "4eb07895-3368-4a19-9faf-566300e20681",
    },
    {
      name: "VIP Normal",
      variation: 1044382,
      price: "55000.00",
      seat: "1ad7c9a4-f829-4fe2-995b-7cebde472989",
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
            cart_id: `variation-seat-test-${Date.now()}-${test.variation}@api`,
            item: 1162153,
            variation: test.variation,
            price: test.price,
            seat: test.seat,
            expires: new Date(
              Date.now() + 15 * 60 * 1000
            ).toISOString(),
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
      message: "All TEST Main Hall variations checked.",
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
