const allowedSourceTypes = new Set(["store_menu", "web_menu", "user_report"]);
const publishableVerificationStatuses = new Set(["verified"]);

function calculateFreshnessStatus(acquiredAt, now = new Date()) {
  const acquired = new Date(`${acquiredAt}T00:00:00+09:00`);
  if (Number.isNaN(acquired.getTime())) {
    return "unknown";
  }

  const elapsedMs = now.getTime() - acquired.getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);

  if (elapsedDays <= 30) {
    return "fresh";
  }

  if (elapsedDays <= 60) {
    return "warning";
  }

  return "stale";
}

function canPublishDrinkPrice(price) {
  return (
    Number.isInteger(price.priceYen) &&
    price.priceYen > 0 &&
    allowedSourceTypes.has(price.sourceType) &&
    publishableVerificationStatuses.has(price.verificationStatus)
  );
}

function formatYen(value) {
  return `¥${value.toLocaleString("ja-JP")}`;
}

function getDistanceMeters(origin, destination) {
  if (!origin || !destination) {
    return null;
  }

  const radiusMeters = 6_371_000;
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(destination.latitude - origin.latitude);
  const dLng = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(radiusMeters * c);
}

module.exports = {
  calculateFreshnessStatus,
  canPublishDrinkPrice,
  formatYen,
  getDistanceMeters,
};

