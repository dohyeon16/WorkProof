import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../alert';
import type { RootScreenProps } from '../navigation/types';
import {
  deleteWorkplace,
  getWorkplace,
  getWorkplaces,
  makeId,
  saveWorkplace,
  setActiveWorkplaceId,
} from '../storage';
import { cancelPaydayReminder, schedulePaydayReminder } from '../notifications';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';

type Props = RootScreenProps<'WorkplaceForm'>;

export default function WorkplaceFormScreen({ navigation, route }: Props) {
  const editingId = route.params?.id;
  const fromOnboarding = route.params?.fromOnboarding ?? false;
  const [name, setName] = useState('');
  const [hourlyWage, setHourlyWage] = useState('');
  const [payDay, setPayDay] = useState('10');
  const [weeklyAllowance, setWeeklyAllowance] = useState(true);
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState('30');
  const [contractPhotoUri, setContractPhotoUri] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(!editingId);

  useEffect(() => {
    if (!editingId) return;
    getWorkplace(editingId).then((w) => {
      if (w) {
        setName(w.name);
        setHourlyWage(String(w.hourlyWage));
        setPayDay(String(w.payDay));
        setWeeklyAllowance(w.weeklyAllowance);
        setBreakMinutesPerShift(String(w.breakMinutesPerShift));
        setContractPhotoUri(w.contractPhotoUri);
      }
      setLoaded(true);
    });
  }, [editingId]);

  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('사진 접근 권한이 필요해요', '설정에서 권한을 허용해주세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setContractPhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    const wage = Number(hourlyWage);
    const day = Number(payDay);
    const breakMin = Number(breakMinutesPerShift);

    if (!name.trim()) {
      Alert.alert('근무지명을 입력해주세요.');
      return;
    }
    if (!Number.isFinite(wage) || wage <= 0) {
      Alert.alert('시급을 올바르게 입력해주세요.');
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      Alert.alert('급여일은 1~31 사이 숫자로 입력해주세요.');
      return;
    }
    if (!Number.isFinite(breakMin) || breakMin < 0) {
      Alert.alert('휴게시간을 올바르게 입력해주세요.');
      return;
    }

    const id = editingId ?? makeId();
    const existingWorkplaces = await getWorkplaces();
    const workplace = {
      id,
      name: name.trim(),
      hourlyWage: wage,
      payDay: day,
      weeklyAllowance,
      breakMinutesPerShift: breakMin,
      contractPhotoUri,
      createdAt: new Date().toISOString(),
    };
    await saveWorkplace(workplace);
    schedulePaydayReminder(workplace).catch(() => {});

    if (!editingId && existingWorkplaces.length === 0) {
      await setActiveWorkplaceId(id);
    }

    if (fromOnboarding) {
      navigation.replace('WorkplaceRegistered', { id });
    } else {
      navigation.goBack();
    }
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert('근무지 삭제', '이 근무지와 관련된 모든 기록이 함께 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteWorkplace(editingId);
          cancelPaydayReminder(editingId).catch(() => {});
          navigation.popToTop();
        },
      },
    ]);
  };

  if (!loaded) return <LoadingScreen />;

  const wageNum = Number(hourlyWage);
  const wagePreview = hourlyWage && Number.isFinite(wageNum) && wageNum > 0 ? `${wageNum.toLocaleString('ko-KR')}원` : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>근무지명</Text>
        <FieldInput
          icon="business-outline"
          value={name}
          onChangeText={setName}
          placeholder="예: OO카페 강남점"
        />

        <Text style={styles.label}>시급</Text>
        <FieldInput
          icon="cash-outline"
          value={hourlyWage}
          onChangeText={setHourlyWage}
          keyboardType="number-pad"
          placeholder="예: 10320"
          suffix="원"
        />
        {wagePreview && <Text style={styles.preview}>= {wagePreview}</Text>}

        <Text style={styles.label}>급여일 (매월)</Text>
        <FieldInput
          icon="calendar-outline"
          value={payDay}
          onChangeText={setPayDay}
          keyboardType="number-pad"
          placeholder="예: 10"
          suffix="일"
          trailingIcon="chevron-down"
        />

        <View style={styles.switchCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>주휴수당 적용 여부</Text>
            <Text style={styles.help}>주 15시간 이상 근무 시 간이 기준으로 자동 반영</Text>
          </View>
          <Switch
            value={weeklyAllowance}
            onValueChange={setWeeklyAllowance}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
          />
        </View>

        <Text style={styles.label}>근무 1건당 기본 휴게시간</Text>
        <FieldInput
          icon="cafe-outline"
          value={breakMinutesPerShift}
          onChangeText={setBreakMinutesPerShift}
          keyboardType="number-pad"
          placeholder="예: 30"
          suffix="분"
        />
        <Text style={styles.help}>
          출퇴근 기록 시 기본값으로 채워지며, 기록마다 수정할 수 있어요.
        </Text>

        <Text style={styles.label}>근로계약서 사본 첨부 (선택)</Text>
        <Pressable
          style={styles.photoPicker}
          onPress={handlePickPhoto}
          accessibilityRole="button"
          accessibilityLabel="근로계약서 사본 사진 추가"
        >
          {contractPhotoUri ? (
            <Image source={{ uri: contractPhotoUri }} style={styles.photoPreview} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={26} color={colors.subtext} />
              <Text style={styles.photoPickerText}>사진 추가</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={styles.saveButton}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? '수정 완료' : '저장하기'}
        >
          <Text style={styles.saveButtonText}>{editingId ? '수정 완료' : '저장하기'}</Text>
        </Pressable>

        {editingId && (
          <Pressable
            style={styles.deleteButton}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="근무지 삭제"
          >
            <Text style={styles.deleteButtonText}>근무지 삭제</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: 12, color: colors.subtext, marginBottom: spacing.md },
  preview: { fontSize: 12, color: colors.primaryDark, fontWeight: '600', marginTop: -spacing.xs, marginBottom: spacing.md },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  switchLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 2 },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadow.card,
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteButton: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  deleteButtonText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  photoPicker: {
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  photoPickerText: { fontSize: 12, color: colors.subtext },
  photoPreview: { width: '100%', height: 140 },
});
