import { StyleSheet, View } from 'react-native';
import { colors } from '../../design_system';

const PIECES: { top: number; left: number; size: number; color: string; rotate: string; round?: boolean }[] = [
  { top: 4, left: 18, size: 8, color: colors.accent, rotate: '15deg' },
  { top: 12, left: 78, size: 6, color: colors.primary, rotate: '-20deg', round: true },
  { top: 30, left: 4, size: 7, color: '#FBBF24', rotate: '35deg' },
  { top: 46, left: 92, size: 9, color: colors.accent, rotate: '-10deg', round: true },
  { top: 60, left: 12, size: 6, color: colors.primaryDark, rotate: '10deg' },
  { top: 70, left: 84, size: 7, color: '#FBBF24', rotate: '-25deg', round: true },
  { top: 0, left: 50, size: 6, color: colors.primary, rotate: '5deg' },
  { top: 82, left: 46, size: 8, color: colors.accent, rotate: '20deg', round: true },
];

/** 축하 화면에 쓰는 장식용 색종이 효과. 절대 위치의 정적 도형들로 구성. */
export function Confetti({ size = 220 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      {PIECES.map((p, idx) => (
        <View
          key={idx}
          style={[
            styles.piece,
            {
              top: `${p.top}%`,
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.round ? p.size : 2,
              transform: [{ rotate: p.rotate }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center' },
  piece: { position: 'absolute' },
});
