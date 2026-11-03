// Endgame positions every player should be able to win or hold, checked with Stockfish
// (depth 20) for the stated result. goal: 'mate' (deliver mate), 'win' (promote and stay
// winning, or mate), 'draw' (hold for `hold` of your moves without falling into a lost position).
export const ENDGAMES = [
  { id: 'kqk', title: 'Queen mate', goal: 'mate', level: 1, fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', idea: 'Use the queen to shrink the king\'s box a knight\'s move away, bring your own king up, then mate on the edge. Watch out for stalemate.' },
  { id: 'krk', title: 'Rook mate', goal: 'mate', level: 1, fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', idea: 'Cut the king off with the rook, walk your king toward it in opposition, and check only when the kings face each other.' },
  { id: 'sixth', title: 'King on the sixth', goal: 'win', level: 2, fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', idea: 'With your king on the sixth rank in front of the pawn, you win whoever is to move. Keep the opposition and escort the pawn.' },
  { id: 'square', title: 'The square of the pawn', goal: 'win', level: 2, fen: '8/8/1k6/8/8/8/6P1/6K1 w - - 0 1', idea: 'Count the square: if the enemy king can\'t step into the pawn\'s square, just push.' },
  { id: 'breakthrough', title: 'Pawn breakthrough', goal: 'win', level: 3, fen: '8/ppp5/8/PPP5/8/8/8/k6K w - - 0 1', idea: 'Three against three with the kings far away: sacrifice two pawns so the third runs through.' },
  { id: 'lucena', title: 'Lucena: build a bridge', goal: 'win', level: 3, fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', idea: 'Cut the king off, bring your rook to the fourth rank, step out with the king, and block the checks with the rook.' },
  { id: 'defendKP', title: 'Hold king and pawn', goal: 'draw', hold: 20, level: 1, fen: '8/8/8/8/4k3/8/4P3/4K3 b - - 0 1', idea: 'Stay in front of the pawn and take the opposition when their king comes up. Never step aside.' },
  { id: 'opposition', title: 'Opposition defence', goal: 'draw', hold: 20, level: 2, fen: '8/8/8/3k4/8/8/3PK3/8 b - - 0 1', idea: 'Keep your king in front of the pawn; answer their king move by facing it.' },
  { id: 'rookpawn', title: 'Rook pawn fortress', goal: 'draw', hold: 15, level: 1, fen: '7k/8/6K1/7P/8/8/8/8 b - - 0 1', idea: 'A rook pawn can\'t win if your king reaches the corner: shuffle between h8 and g8 and stalemate looms.' },
  { id: 'wrongbishop', title: 'Wrong bishop', goal: 'draw', hold: 15, level: 2, fen: '7k/8/5K2/7P/8/8/2B5/8 b - - 0 1', idea: 'Bishop and rook pawn of the wrong colour: stay in the corner the bishop doesn\'t control.' },
  { id: 'philidor', title: 'Philidor defence', goal: 'draw', hold: 25, level: 3, fen: '4k3/R7/1r6/3KP3/8/8/8/8 b - - 0 1', idea: 'Keep your rook on the third rank (here the sixth) until the pawn advances, then check from behind.' },
];
