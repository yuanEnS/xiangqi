// Elo 等级分：赢强手加得多，输给弱手扣得多。新手前 30 局变化快一些，尽快接近真实水平。
const START = 1200;
const NEW_PLAYER_GAMES = 30;

function kFactor(games) {
  return games < NEW_PLAYER_GAMES ? 32 : 20;
}

// score：赢 1，和 0.5，输 0
function ratingDelta(mine, other, score, games) {
  const expected = 1 / (1 + Math.pow(10, (other - mine) / 400));
  return Math.round(kFactor(games) * (score - expected));
}

module.exports = { START, ratingDelta };
