import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { InputAccessoryToolbar } from '../../../shared/components/InputAccessoryToolbar';
import { useNumericInputNavigation } from '../../../shared/hooks/useNumericInputNavigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Alert } from '../../../shared/components/alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import {
  deleteWorkplace,
  getWorkplace,
  getWorkplaces,
  makeId,
  saveContractEvidence,
  saveWorkplace,
  setActiveWorkplaceId,
} from '../../../core/data/storage';
import { cancelPaydayReminder, schedulePaydayReminder } from '../../../core/notifications/notifications';
import { MINIMUM_HOURLY_WAGE, MINIMUM_WAGE_YEAR } from '../../../core/domain/payroll/payCalc';
import { analyzeEvidenceFile, maskFileName, type AnalyzeEvidenceResult } from '../../evidence/services/ai/analyzeContract';
import { useAiAnalysis } from '../../evidence/services/ai/useAiAnalysis';
import { FILE_UNREADABLE_MESSAGE } from '../../evidence/services/ocr/visionOcr';
import { persistPickedFile, resolveReadableUri } from '../../../shared/utils/fileStore';
import type { EvidenceKind, IncomeDeductionType } from '../../../core/domain/models/types';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = RootScreenProps<'WorkplaceForm'>;

// 숫자 입력 순서: 시급 → 급여일 → 기본 휴게시간(마지막 → '완료').
const NUMERIC_FIELDS = ['wage', 'payDay', 'break'] as const;

const DEDUCTION_OPTIONS: { value: IncomeDeductionType; label: string }[] = [
  { value: 'none', label: '공제 없음' },
  { value: 'withholding', label: '3.3% 원천징수' },
  { value: 'insurance', label: '4대보험' },
];

export default function WorkplaceFormScreen({ navigation, route }: Props) {
  const editingId = route.params?.id;
  const fromOnboarding = route.params?.fromOnboarding ?? false;
  // AI 분석 접근층(프록시 remote + 비로그인 게이트). 새 분석 시작 전에만 인증을 요구한다.
  const ai = useAiAnalysis();
  const [name, setName] = useState('');
  const [hourlyWage, setHourlyWage] = useState('');
  const [payDay, setPayDay] = useState('10');
  const [weeklyAllowance, setWeeklyAllowance] = useState(true);
  const [fiveOrMoreEmployees, setFiveOrMoreEmployees] = useState(false);
  const [incomeDeductionType, setIncomeDeductionType] = useState<IncomeDeductionType>('none');
  const [breakMinutesPerShift, setBreakMinutesPerShift] = useState('30');
  const [contractPhotoUri, setContractPhotoUri] = useState<string | undefined>(undefined);
  // 저장용 URI(웹은 idb:// 참조)는 <Image>가 못 그리므로, 미리보기용 URI를 따로 둔다.
  const [contractDisplayUri, setContractDisplayUri] = useState<string | undefined>(undefined);
  const [contractFileKind, setContractFileKind] = useState<EvidenceKind | undefined>(undefined);
  const [contractFileName, setContractFileName] = useState<string | undefined>(undefined);
  const [contractFileSize, setContractFileSize] = useState<number | null>(null);
  const [contractMimeType, setContractMimeType] = useState<string | undefined>(undefined);
  const [contractAnalyzedAt, setContractAnalyzedAt] = useState<string | undefined>(undefined);
  const [contractOcrText, setContractOcrText] = useState<string | undefined>(undefined);
  const [contractSummary, setContractSummary] = useState<string | undefined>(undefined);
  // OCR+요약을 하나의 분석 단계로 합쳐 진행 상태를 관리한다.
  const [analyzing, setAnalyzing] = useState(false);
  // 분석 경쟁/중복 제어는 state가 아니라 ref로 한다(렌더 타이밍에 의존하지 않기 위함).
  const analysisRequestIdRef = useRef(0); // 새 분석마다 증가 — 최신 요청 결과만 반영
  const analysisInFlightRef = useRef(false); // 재시도 버튼 중복 실행 방지
  const pickBusyRef = useRef(false); // 파일 선택기 동시 실행 방지(같은 영역 빠른 두 번 탭)
  const mountedRef = useRef(true); // unmount 후 setState 방지
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(!editingId);

  // 숫자 입력 필드 간 포커스 이동 + iOS 툴바('다음'/'완료')를 공용 훅으로 처리.
  const numericNav = useNumericInputNavigation(NUMERIC_FIELDS);

  // 숫자 입력 정제: 시급은 숫자만, 급여일은 숫자만 + 1~31 상한, 휴게시간은 숫자만(음수 방지).
  const handleWageChange = (t: string) => setHourlyWage(t.replace(/[^0-9]/g, ''));
  const handlePayDayChange = (t: string) => {
    const digits = t.replace(/[^0-9]/g, '');
    if (digits === '') {
      setPayDay('');
      return;
    }
    setPayDay(String(Math.min(31, parseInt(digits, 10))));
  };
  const handleBreakChange = (t: string) => setBreakMinutesPerShift(t.replace(/[^0-9]/g, ''));

  useEffect(() => {
    if (!editingId) return;
    getWorkplace(editingId).then((w) => {
      if (w) {
        setName(w.name);
        setHourlyWage(String(w.hourlyWage));
        setPayDay(String(w.payDay));
        setWeeklyAllowance(w.weeklyAllowance);
        setFiveOrMoreEmployees(w.fiveOrMoreEmployees ?? false);
        setIncomeDeductionType(w.incomeDeductionType ?? 'none');
        setBreakMinutesPerShift(String(w.breakMinutesPerShift));
        setContractPhotoUri(w.contractPhotoUri);
        setContractFileKind(w.contractFileKind);
        // 이전에 저장된 계약서에는 원본 파일명이 없으므로 기본 이름을 채워둔다
        // (보관함에 이미 있으면 그 이름을 유지한다 — saveContractEvidence 참고).
        if (w.contractPhotoUri) {
          setContractFileName(`근로계약서.${w.contractFileKind === 'pdf' ? 'pdf' : 'jpg'}`);
          setContractMimeType(w.contractFileKind === 'pdf' ? 'application/pdf' : 'image/jpeg');
          // 저장된 참조(idb://)를 미리보기용으로 되돌린다.
          const stored = w.contractPhotoUri;
          resolveReadableUri(stored).then((d) => setContractDisplayUri(d ?? undefined));
        }
        setContractOcrText(w.contractOcrText);
        setContractSummary(w.contractSummary);
        setLatitude(w.latitude);
        setLongitude(w.longitude);
        setAddress(w.address);
      }
      setLoaded(true);
    });
  }, [editingId]);

  // 지도에서 근무지를 검색해 고르고 돌아오면 App.tsx의 네이버 리다이렉트 복귀
  // 처리와 같은 방식으로, WorkplacePlacePicker가 이 화면의 params에 결과를
  // 담아 navigate로 되돌아온다.
  useEffect(() => {
    if (route.params?.pickedLatitude == null || route.params?.pickedLongitude == null) return;
    setLatitude(route.params.pickedLatitude);
    setLongitude(route.params.pickedLongitude);
    setAddress(route.params.pickedAddress);
    if (route.params.pickedName) setName(route.params.pickedName);
    navigation.setParams({
      pickedLatitude: undefined,
      pickedLongitude: undefined,
      pickedAddress: undefined,
      pickedName: undefined,
    });
  }, [route.params?.pickedLatitude, route.params?.pickedLongitude, route.params?.pickedAddress, route.params?.pickedName]);

  // 화면이 사라진 뒤 분석 결과가 늦게 도착해도 setState하지 않도록 마운트 상태를 추적한다.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 분석 결과에 대한 사용자 안내는 요청당 최대 1회만 띄운다(재시도는 내부에서 조용히 처리됨).
  const showAnalysisResultAlert = (result: AnalyzeEvidenceResult) => {
    if (result.status === 'success') return; // 성공: 팝업 없이 요약을 화면에 표시
    // 진행 중 인증 만료 → 로그인 게이트(인식된 텍스트가 있으면 이미 위에서 보존됨).
    if (result.errorCode === 'AUTH_REQUIRED') {
      ai.promptLogin();
      return;
    }
    if (result.status === 'ocr_only') {
      if (result.errorCode === 'SUMMARY_NOT_CONFIGURED') {
        Alert.alert('AI 요약 준비 중', 'AI 요약 기능이 아직 준비 중이에요. 인식된 텍스트는 저장했어요.');
      } else {
        Alert.alert('AI 요약 실패', '인식된 계약서 텍스트는 저장했어요. AI 요약은 잠시 후 다시 시도해주세요.');
      }
      return;
    }
    // status === 'error' — OCR까지 실패
    if (result.errorCode === 'OCR_NOT_CONFIGURED') {
      Alert.alert('OCR 준비 중', '문서 인식 기능이 아직 준비 중이에요. 잠시 후 다시 시도해주세요.');
    } else if (result.errorCode === 'FILE_NOT_READY') {
      Alert.alert('원본 파일 없음', FILE_UNREADABLE_MESSAGE);
    } else {
      Alert.alert('텍스트 추출 실패', '계약서 내용을 인식하지 못했어요. 사진 상태를 확인하고 다시 시도해주세요.');
    }
  };

  // 공용 분석 파이프라인 호출. requestId로 세대를 관리해 최신 요청 결과만 화면에 반영한다.
  const startAnalysis = async (uri: string, name: string, mimeType: string, size?: number | null) => {
    // 새 OCR/AI provider 요청은 로그인 필요 — 비로그인이면 요청을 시작하지 않고 게이트만 띄운다.
    if (!ai.ensureCanAnalyze()) return;
    const requestId = ++analysisRequestIdRef.current;
    analysisInFlightRef.current = true;
    if (mountedRef.current) {
      setAnalyzing(true);
      setContractOcrText(undefined);
      setContractSummary(undefined);
    }

    let result: AnalyzeEvidenceResult;
    try {
      result = await analyzeEvidenceFile(ai.remote, {
        uri,
        name,
        mimeType,
        size,
        logContext: { screen: 'WorkplaceForm', requestId },
      });
    } catch (e) {
      console.warn('[WorkplaceForm] 분석 예외:', e instanceof Error ? e.message : String(e));
      result = { status: 'error', errorCode: 'OCR_FAILED' };
    }

    // 더 최신 분석이 시작됐거나(다른 파일 선택) 화면이 사라졌으면 이 결과는 버린다.
    if (requestId !== analysisRequestIdRef.current || !mountedRef.current) {
      console.log('[analyze] REQUEST_SUPERSEDED', { screen: 'WorkplaceForm', file: maskFileName(name), requestId });
      return;
    }
    analysisInFlightRef.current = false;
    setAnalyzing(false);

    // OCR 텍스트는 요약 성공 여부와 무관하게 보존한다.
    if (result.ocrText) {
      setContractOcrText(result.ocrText);
      setContractAnalyzedAt(result.analyzedAt);
    }
    if (result.aiSummary) setContractSummary(result.aiSummary);

    showAnalysisResultAlert(result);
  };

  // 인식 텍스트 카드의 "다시 분석하기" — 진행 중이면 무시(중복 호출 방지).
  const retryAnalysis = () => {
    if (analysisInFlightRef.current || !contractPhotoUri) return;
    const mime = contractMimeType ?? (contractFileKind === 'pdf' ? 'application/pdf' : 'image/jpeg');
    void startAnalysis(contractPhotoUri, contractFileName ?? '근로계약서', mime, contractFileSize);
  };

  const handlePickImage = async () => {
    // pickBusyRef: 선택기가 열려있는 동안 같은 영역을 다시 탭해도 두 번째 선택을 막는다.
    if (pickBusyRef.current) {
      console.log('[analyze] DUPLICATE_REQUEST_BLOCKED', { screen: 'WorkplaceForm', reason: 'pick-image' });
      return;
    }
    pickBusyRef.current = true;
    try {
      // 웹은 권한 개념이 없고, 권한 요청을 await하면 파일 다이얼로그가 user-gesture를
      // 잃어 안 열릴 수 있으므로 네이티브에서만 권한을 확인한다.
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('사진 접근 권한이 필요해요', '설정에서 권한을 허용해주세요.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: Platform.OS === 'web',
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `근로계약서_${Date.now()}.jpg`;
      const size = asset.fileSize ?? null;
      // 선택기의 임시 URI를 영구 저장소(네이티브 documentDirectory / 웹 idb)로 옮긴다.
      const uri = await persistPickedFile({ uri: asset.uri, name, mimeType, base64: asset.base64 });
      setContractPhotoUri(uri);
      setContractDisplayUri((await resolveReadableUri(uri)) ?? undefined);
      setContractFileKind('image');
      setContractFileName(name);
      setContractFileSize(size);
      setContractMimeType(mimeType);
      // 분석은 기다리지 않고 시작한다 → pickBusyRef가 곧 풀려, 분석 중 다른 파일을
      // 다시 선택하면 그 요청이 이전 결과를 대체(supersede)할 수 있다.
      void startAnalysis(uri, name, mimeType, size);
    } catch (e) {
      console.warn('[WorkplaceForm] 계약서 사진 저장 실패:', e);
      Alert.alert('사진을 첨부하지 못했어요', '다시 시도해주세요.');
    } finally {
      pickBusyRef.current = false;
    }
  };

  const handlePickDocument = async () => {
    if (pickBusyRef.current) {
      console.log('[analyze] DUPLICATE_REQUEST_BLOCKED', { screen: 'WorkplaceForm', reason: 'pick-document' });
      return;
    }
    pickBusyRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        base64: Platform.OS === 'web',
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType =
        asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const size = asset.size ?? null;
      const uri = await persistPickedFile({ uri: asset.uri, name: asset.name, mimeType, base64: asset.base64 });
      setContractPhotoUri(uri);
      setContractDisplayUri((await resolveReadableUri(uri)) ?? undefined);
      setContractFileKind(mimeType === 'application/pdf' ? 'pdf' : 'image');
      setContractFileName(asset.name);
      setContractFileSize(size);
      setContractMimeType(mimeType);
      void startAnalysis(uri, asset.name, mimeType, size);
    } catch (e) {
      console.warn('[WorkplaceForm] 계약서 파일 저장 실패:', e);
      Alert.alert('파일을 첨부하지 못했어요', '다시 시도해주세요.');
    } finally {
      pickBusyRef.current = false;
    }
  };

  const handlePickContract = () => {
    Alert.alert('근로계약서 사본 첨부', '사진 또는 PDF 파일로 첨부할 수 있어요.', [
      { text: '사진 보관함에서 선택', onPress: handlePickImage },
      { text: '파일에서 선택 (PDF 등)', onPress: handlePickDocument },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const handleSave = async () => {
    const wage = Number(hourlyWage);
    const day = Number(payDay);
    const breakMin = Number(breakMinutesPerShift);

    if (!name.trim()) {
      Alert.alert('근무지를 선택해주세요', '지도에서 근무지를 검색해 선택해주세요.');
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

    // 최저임금 미달이면 경고하되, 사용자가 원하면 그대로 저장할 수 있게 한다(강제 차단 아님).
    if (wage < MINIMUM_HOURLY_WAGE) {
      Alert.alert(
        '최저임금보다 낮아요',
        `입력한 시급(${wage.toLocaleString('ko-KR')}원)이 ${MINIMUM_WAGE_YEAR}년 최저임금 ${MINIMUM_HOURLY_WAGE.toLocaleString(
          'ko-KR'
        )}원보다 낮아요. 그래도 저장할까요?`,
        [
          { text: '다시 입력', style: 'cancel' },
          { text: '그대로 저장', onPress: () => void persistWorkplace(wage, day, breakMin) },
        ]
      );
      return;
    }
    await persistWorkplace(wage, day, breakMin);
  };

  const persistWorkplace = async (wage: number, day: number, breakMin: number) => {
    const id = editingId ?? makeId();
    const existingWorkplaces = await getWorkplaces();
    const workplace = {
      id,
      name: name.trim(),
      hourlyWage: wage,
      payDay: day,
      weeklyAllowance,
      fiveOrMoreEmployees,
      incomeDeductionType,
      breakMinutesPerShift: breakMin,
      contractPhotoUri,
      contractFileKind,
      contractOcrText,
      contractSummary,
      latitude,
      longitude,
      address,
      createdAt: new Date().toISOString(),
    };
    await saveWorkplace(workplace);
    schedulePaydayReminder(workplace).catch(() => {});

    // 근무지 저장이 확정된 지금(=취소가 아닌 시점)에만 계약서를 증빙 보관함에 남긴다.
    // 계약서 파일이 첨부돼 있으면 OCR 성공 여부와 무관하게 저장한다:
    //  - OCR 성공: ocrText(+요약 성공 시 aiSummary)와 analyzedAt까지 저장
    //  - OCR/요약 실패: 파일만 저장 → 보관함에서 'AI로 분석하기'로 나중에 재시도
    // 증빙 저장이 실패해도 근무지 등록 자체는 막지 않도록 예외를 삼킨다.
    if (contractPhotoUri) {
      try {
        await saveContractEvidence({
          workplaceId: id,
          name: contractFileName ?? `근로계약서.${contractFileKind === 'pdf' ? 'pdf' : 'jpg'}`,
          uri: contractPhotoUri,
          kind: contractFileKind ?? 'image',
          mimeType: contractMimeType,
          size: contractFileSize,
          ocrText: contractOcrText,
          aiSummary: contractSummary,
          analyzedAt: contractOcrText ? contractAnalyzedAt ?? new Date().toISOString() : undefined,
        });
      } catch (e) {
        console.warn('계약서 증빙 저장 실패:', e);
      }
    }

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

  const insets = useSafeAreaInsets();

  if (!loaded) return <LoadingScreen />;

  const wageNum = Number(hourlyWage);
  const wagePreview = hourlyWage && Number.isFinite(wageNum) && wageNum > 0 ? `${wageNum.toLocaleString('ko-KR')}원` : null;
  const belowMinWage = !!hourlyWage && Number.isFinite(wageNum) && wageNum > 0 && wageNum < MINIMUM_HOURLY_WAGE;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>근무지</Text>
        <Pressable
          style={styles.placeCard}
          onPress={() => navigation.navigate('WorkplacePlacePicker', { latitude, longitude })}
          accessibilityRole="button"
          accessibilityLabel="지도에서 근무지 검색"
        >
          <View style={styles.placeIcon}>
            <Ionicons name="location" size={20} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            {name ? (
              <>
                <Text style={styles.placeName}>{name}</Text>
                <Text style={styles.placeSubtext}>{address ?? '탭해서 위치 변경'}</Text>
              </>
            ) : (
              <Text style={styles.placeName}>지도에서 근무지 검색하기</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </Pressable>

        <Text style={styles.label}>시급</Text>
        <FieldInput
          {...numericNav.getFieldProps('wage')}
          icon="cash-outline"
          value={hourlyWage}
          onChangeText={handleWageChange}
          keyboardType="number-pad"
          placeholder="예: 10320"
          suffix="원"
        />
        {wagePreview && <Text style={styles.preview}>= {wagePreview}</Text>}
        {belowMinWage && (
          <Text style={styles.wageWarn}>
            <Ionicons name="alert-circle" size={12} color={colors.danger} /> {MINIMUM_WAGE_YEAR}년 최저임금(
            {MINIMUM_HOURLY_WAGE.toLocaleString('ko-KR')}원)보다 낮아요.
          </Text>
        )}

        <Text style={styles.label}>급여일 (매월)</Text>
        <FieldInput
          {...numericNav.getFieldProps('payDay')}
          icon="calendar-outline"
          value={payDay}
          onChangeText={handlePayDayChange}
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

        <View style={styles.switchCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>5인 이상 사업장</Text>
            <Text style={styles.help}>연장근로(일 8시간·주 40시간 초과) 가산수당 자동 반영</Text>
          </View>
          <Switch
            value={fiveOrMoreEmployees}
            onValueChange={setFiveOrMoreEmployees}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
          />
        </View>

        <Text style={styles.label}>세금·공제 유형</Text>
        <View style={styles.segment}>
          {DEDUCTION_OPTIONS.map((opt) => {
            const active = incomeDeductionType === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setIncomeDeductionType(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.help}>
          세후 예상 실수령액을 어림하는 데 쓰여요. 정확한 공제액은 사업장·소득에 따라 달라질 수 있어요.
        </Text>

        <Text style={styles.label}>근무 1건당 기본 휴게시간</Text>
        <FieldInput
          {...numericNav.getFieldProps('break')}
          icon="cafe-outline"
          value={breakMinutesPerShift}
          onChangeText={handleBreakChange}
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
          onPress={handlePickContract}
          accessibilityRole="button"
          accessibilityLabel="근로계약서 사본 첨부"
        >
          {contractPhotoUri ? (
            contractFileKind === 'pdf' ? (
              <View style={styles.pdfPreview}>
                <Ionicons name="document-text-outline" size={32} color={colors.primaryDark} />
                <Text style={styles.pdfPreviewText} numberOfLines={1}>
                  PDF 첨부됨
                </Text>
              </View>
            ) : contractDisplayUri ? (
              <Image source={{ uri: contractDisplayUri }} style={styles.photoPreview} />
            ) : (
              <View style={styles.pdfPreview}>
                <Ionicons name="image-outline" size={32} color={colors.primaryDark} />
                <Text style={styles.pdfPreviewText} numberOfLines={1}>
                  이미지 첨부됨
                </Text>
              </View>
            )
          ) : (
            <>
              <Ionicons name="camera-outline" size={26} color={colors.subtext} />
              <Text style={styles.photoPickerText}>사진/PDF 추가</Text>
            </>
          )}
        </Pressable>

        {analyzing && (
          <View style={styles.ocrStatusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.ocrStatusText}>계약서를 분석하고 있어요.</Text>
          </View>
        )}
        {!analyzing && contractOcrText && (
          <View style={styles.ocrCard}>
            <View style={styles.ocrCardHeader}>
              <Ionicons name="sparkles-outline" size={14} color={colors.primaryDark} />
              <Text style={styles.ocrCardTitle}>인식된 계약서 텍스트</Text>
            </View>
            <ScrollView style={styles.ocrTextScroll} nestedScrollEnabled>
              <Text style={styles.ocrText}>{contractOcrText}</Text>
            </ScrollView>
          </View>
        )}

        {!analyzing && contractOcrText && (
          <View style={styles.summaryCard}>
            <View style={styles.ocrCardHeader}>
              <Ionicons name="bulb-outline" size={14} color={colors.primaryDark} />
              <Text style={styles.ocrCardTitle}>AI 요약</Text>
            </View>
            {contractSummary ? (
              <>
                <Text style={styles.summaryText}>{contractSummary}</Text>
                <Pressable
                  style={styles.summaryRetryButton}
                  onPress={retryAnalysis}
                  accessibilityRole="button"
                  accessibilityLabel="다시 분석하기"
                >
                  <Ionicons name="refresh-outline" size={13} color={colors.primaryDark} />
                  <Text style={styles.summaryRetryText}>다시 분석하기</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={styles.summaryRetryButton}
                onPress={retryAnalysis}
                accessibilityRole="button"
                accessibilityLabel="AI로 다시 분석하기"
              >
                <Ionicons name="sparkles-outline" size={13} color={colors.primaryDark} />
                <Text style={styles.summaryRetryText}>AI로 다시 분석하기</Text>
              </Pressable>
            )}
          </View>
        )}

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

      <InputAccessoryToolbar
        nativeID={numericNav.accessoryViewID}
        label={numericNav.accessoryLabel}
        onPress={numericNav.onAccessoryPress}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: 12, color: colors.subtext, marginBottom: spacing.md },
  preview: { fontSize: 12, color: colors.primaryDark, fontWeight: '600', marginTop: -spacing.xs, marginBottom: spacing.md },
  wageWarn: { fontSize: 12, color: colors.danger, fontWeight: '600', marginTop: -spacing.sm, marginBottom: spacing.md },
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
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
    marginBottom: spacing.xs,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentItemActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.subtext },
  segmentTextActive: { color: '#fff' },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  placeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeName: { fontSize: 14, fontWeight: '700', color: colors.text },
  placeSubtext: { fontSize: 12, color: colors.subtext, marginTop: 2 },
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
  pdfPreview: { paddingVertical: spacing.md, alignItems: 'center', gap: spacing.xs },
  pdfPreviewText: { fontSize: 12, color: colors.primaryDark, fontWeight: '700' },
  ocrStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  ocrStatusText: { fontSize: 12, color: colors.subtext },
  ocrCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  ocrCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  ocrCardTitle: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  ocrTextScroll: { maxHeight: 160 },
  ocrText: { fontSize: 12, color: colors.text, lineHeight: 18 },
  summaryCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  summaryText: { fontSize: 13, color: colors.text, lineHeight: 19 },
  summaryRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  summaryRetryText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
});
