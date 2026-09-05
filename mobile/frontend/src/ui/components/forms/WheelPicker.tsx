import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../display/Text';
import { colors, radius } from '../../design_system';

const ITEM_HEIGHT = 40;
const VISIBLE_COUNT = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;
const CENTER_OFFSET = ITEM_HEIGHT * Math.floor(VISIBLE_COUNT / 2);
const DRAG_HYSTERESIS = 10;
const RUBBERBAND_CONSTANT = 0.55;
const MOMENTUM_PROJECTION_MS = 180;
const SPRING = { tension: 300, settleFriction: 30, momentumFriction: 24 } as const;

interface WheelPickerProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  disabled?: boolean;
  /**
   * 휠을 만지는(드래그하는) 동안 true, 끝나면 false. 부모 ScrollView가 이 값으로
   * scrollEnabled를 토글해 휠 조작 중 화면이 같이 스크롤되지 않게 한다(네이티브).
   */
  onActiveChange?: (active: boolean) => void;
}

/**
 * iOS 타이머 앱 스타일의 세로 휠 선택기.
 *
 * FlatList의 네이티브 모멘텀 스크롤에 기대는 대신(브라우저 관성과 우리가 보정하려는
 * scrollTo가 서로 충돌해 두 항목 사이 어중간한 위치에서 멈추는 문제가 있었음),
 * PanResponder + 단일 Animated.Value로 전체 이동을 직접 계산·소유해 항상 정확한
 * 항목 위치로만 멈추도록 한다.
 */
export function WheelPicker({ min, max, step = 1, value, onChange, suffix, disabled, onActiveChange }: WheelPickerProps) {
  const data = useMemo(() => {
    const arr: number[] = [];
    for (let n = min; n <= max; n += step) arr.push(n);
    return arr;
  }, [min, max, step]);

  const maxOffset = (data.length - 1) * ITEM_HEIGHT;
  const initialIndex = Math.max(0, data.indexOf(value));

  const offsetY = useRef(new Animated.Value(initialIndex * ITEM_HEIGHT)).current;
  const currentOffsetRef = useRef(initialIndex * ITEM_HEIGHT);
  const dragStartOffset = useRef(initialIndex * ITEM_HEIGHT);
  const lastEmittedValue = useRef(value);
  const disabledRef = useRef(disabled);
  const wheelSnapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<View>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // PanResponder는 최초 1회만 생성되므로, 최신 onActiveChange를 ref로 참조한다.
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);

  const setActive = (active: boolean) => onActiveChangeRef.current?.(active);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  // 언마운트(또는 비활성 전환) 시 부모 스크롤 잠금이 영구히 남지 않도록 반드시 해제.
  useEffect(() => {
    return () => onActiveChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    const id = offsetY.addListener(({ value: v }) => {
      currentOffsetRef.current = v;
    });
    return () => offsetY.removeListener(id);
  }, [offsetY]);

  const animateTo = (targetOffset: number, velocity: number) => {
    offsetY.stopAnimation();
    if (reduceMotion) {
      Animated.timing(offsetY, { toValue: targetOffset, duration: 1, useNativeDriver: false }).start();
      return;
    }
    Animated.spring(offsetY, {
      toValue: targetOffset,
      useNativeDriver: false,
      velocity,
      tension: SPRING.tension,
      friction: Math.abs(velocity) > 0.25 ? SPRING.momentumFriction : SPRING.settleFriction,
    }).start();
  };

  const rubberband = (offset: number) => {
    if (offset < 0) return -Math.min(ITEM_HEIGHT, -offset * RUBBERBAND_CONSTANT);
    if (offset > maxOffset) return maxOffset + Math.min(ITEM_HEIGHT, (offset - maxOffset) * RUBBERBAND_CONSTANT);
    return offset;
  };

  // Keep the wheel's visual position in sync when `value` changes from
  // outside (e.g. a parent forcing it back to 0), not just from our own drag.
  useEffect(() => {
    if (value !== lastEmittedValue.current) {
      lastEmittedValue.current = value;
      const idx = Math.max(0, data.indexOf(value));
      animateTo(idx * ITEM_HEIGHT, 0);
    }
  }, [value, data, offsetY, reduceMotion]);

  const snapTo = (targetOffset: number, velocity = 0) => {
    const clamped = Math.max(0, Math.min(maxOffset, targetOffset));
    const index = Math.max(0, Math.min(data.length - 1, Math.round(clamped / ITEM_HEIGHT)));
    animateTo(index * ITEM_HEIGHT, velocity);
    lastEmittedValue.current = data[index];
    onChange(data[index]);
  };

  useEffect(() => {
    return () => {
      if (wheelSnapTimeout.current) clearTimeout(wheelSnapTimeout.current);
    };
  }, []);

  // Web-only: trackpad/mouse-wheel scrolling over the picker was bubbling up
  // to the parent ScrollView (scrolling the whole screen) instead of turning
  // the wheel, since PanResponder only ever sees touch/mouse-drag gestures.
  const handleWheel = (e: { deltaY: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (disabledRef.current) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    offsetY.stopAnimation();
    const next = currentOffsetRef.current + e.deltaY;
    offsetY.setValue(rubberband(next));
    if (wheelSnapTimeout.current) clearTimeout(wheelSnapTimeout.current);
    wheelSnapTimeout.current = setTimeout(() => snapTo(currentOffsetRef.current), 120);
  };

  // 최신 handleWheel을 ref로 참조(리스너는 1회만 등록).
  const handleWheelRef = useRef(handleWheel);
  handleWheelRef.current = handleWheel;

  // Web: React의 onWheel은 passive로 등록돼 preventDefault가 무시되어 페이지가 같이
  // 스크롤된다. 휠 영역 DOM에 passive:false 네이티브 리스너를 직접 붙여야 막힌다.
  // 리스너는 휠 영역에만 있으므로 마우스가 밖에 있을 땐 페이지 스크롤이 정상 동작한다.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = wrapRef.current as unknown as HTMLElement | null;
    if (!node) return;
    const listener = (e: WheelEvent) => handleWheelRef.current(e);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // Claim the gesture in the capture phase so the wrapping ScrollView
      // never gets a chance to start scrolling the whole screen alongside it.
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture: (_, gesture) => !disabledRef.current && Math.abs(gesture.dy) > DRAG_HYSTERESIS,
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_, gesture) => !disabledRef.current && Math.abs(gesture.dy) > DRAG_HYSTERESIS,
      onPanResponderGrant: () => {
        offsetY.stopAnimation();
        dragStartOffset.current = currentOffsetRef.current;
        setActive(true); // 부모 ScrollView 잠금
      },
      onPanResponderMove: (_, gesture) => {
        const next = dragStartOffset.current - gesture.dy;
        offsetY.setValue(rubberband(next));
      },
      onPanResponderRelease: (_, gesture) => {
        const projected = currentOffsetRef.current - gesture.vy * MOMENTUM_PROJECTION_MS;
        snapTo(projected, -gesture.vy);
        setActive(false); // 손을 떼면(휠 밖에서 떼도) 부모 스크롤 복구
      },
      onPanResponderTerminate: () => {
        snapTo(currentOffsetRef.current);
        setActive(false); // 제스처가 중단돼도 반드시 복구
      },
    })
  ).current;

  return (
    <View
      ref={wrapRef}
      style={[styles.wrap, disabled && styles.wrapDisabled]}
      {...panResponder.panHandlers}
    >
      <View pointerEvents="none" style={styles.highlight} />
      <Animated.View style={[styles.track, { transform: [{ translateY: Animated.multiply(offsetY, -1) }] }]}>
        {data.map((item, index) => {
          const inputRange = [
            (index - 2) * ITEM_HEIGHT,
            (index - 1) * ITEM_HEIGHT,
            index * ITEM_HEIGHT,
            (index + 1) * ITEM_HEIGHT,
            (index + 2) * ITEM_HEIGHT,
          ];
          const opacity = offsetY.interpolate({
            inputRange,
            outputRange: [0.25, 0.5, 1, 0.5, 0.25],
            extrapolate: 'clamp',
          });
          const scale = offsetY.interpolate({
            inputRange,
            outputRange: [0.85, 0.92, 1, 0.92, 0.85],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View key={item} style={[styles.item, { opacity, transform: [{ scale }] }]}>
              <Text style={styles.itemText}>
                {item}
                {suffix}
              </Text>
            </Animated.View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: PICKER_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
    // @ts-expect-error web-only CSS property — stops the browser from also
    // native-scrolling the parent ScrollView during this drag.
    touchAction: 'none',
  },
  wrapDisabled: { opacity: 0.4 },
  track: { paddingTop: CENTER_OFFSET },
  highlight: {
    position: 'absolute',
    top: CENTER_OFFSET,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
  },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 18, fontWeight: '700', color: colors.text },
});
