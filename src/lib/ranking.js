export const RANK_TIERS = [
  { name: "Bronze", min: 1000, max: 1199, color: "#b87333", icon: "fa-medal" },
  { name: "Silver", min: 1200, max: 1399, color: "#c0c0c0", icon: "fa-medal" },
  { name: "Gold", min: 1400, max: 1599, color: "#f5c542", icon: "fa-medal" },
  { name: "Platinum", min: 1600, max: 1799, color: "#8bd3dd", icon: "fa-gem" },
  { name: "Diamond", min: 1800, max: 1999, color: "#60a5fa", icon: "fa-gem" },
  { name: "Titanium", min: 2000, max: 2199, color: "#94a3b8", icon: "fa-shield-halved" },
  { name: "Elite", min: 2200, max: 2399, color: "#a855f7", icon: "fa-crown" },
  { name: "Champion", min: 2400, max: 2599, color: "#f97316", icon: "fa-crown" },
  { name: "Master", min: 2600, max: 2799, color: "#ef4444", icon: "fa-fire" },
  { name: "Grandmaster", min: 2800, max: Infinity, color: "#facc15", icon: "fa-star" },
];

export function getRankFromRating(rating = 1000) {
  return (
    RANK_TIERS.find((tier) => rating >= tier.min && rating <= tier.max) ||
    RANK_TIERS[RANK_TIERS.length - 1]
  );
}

export function calcElo(rating, opponentRating, actual, k = 32) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  const newRating = Math.round(rating + k * (actual - expected));
  return { expected, newRating, delta: newRating - rating };
}
