const PRETIX_BASE =
  "https://pretix.eu/api/v1/organizers/TEDxRegents/events/2027";

const QUOTAS = {
  mainHallTotal: 6227772,
  mainHallEarlyBird: 6227773,

  watchPartyTotal: 6227040,
  watchPartyEarlyBird: 6227039,
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed. Use GET.",
    });
  }

  try {
    const headers = {
      Authorization: `Token ${process.env.PRETIX_API_TOKEN}`,
      Accept: "application/json",
    };

    const getQuota = async (quotaId) => {
      const response = await fetch(
        `${PRETIX_BASE}/quotas/${quotaId}/availability/`,
        { headers }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
          `Pretix quota request failed with status ${response.status}`
        );
      }

      return data;
    };

    const [
      mainHallTotal,
      mainHallEarlyBird,
      watchPartyTotal,
      watchPartyEarlyBird,
    ] = await Promise.all([
      getQuota(QUOTAS.mainHallTotal),
      getQuota(QUOTAS.mainHallEarlyBird),
      getQuota(QUOTAS.watchPartyTotal),
      getQuota(QUOTAS.watchPartyEarlyBird),
    ]);

    return res.status(200).json({
      success: true,

      mainHall: {
        available: mainHallTotal.available,
        availableNumber: mainHallTotal.available_number,
      },

      mainHallEarlyBird: {
        available: mainHallEarlyBird.available,
        availableNumber: mainHallEarlyBird.available_number,
      },

      watchParty: {
        available: watchPartyTotal.available,
        availableNumber: watchPartyTotal.available_number,
      },

      watchPartyEarlyBird: {
        available: watchPartyEarlyBird.available,
        availableNumber: watchPartyEarlyBird.available_number,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
