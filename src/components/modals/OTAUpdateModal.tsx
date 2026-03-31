import React, { useRef } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  PanResponder,
  Animated,
} from 'react-native';
import { Modal, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ── Color palettes (identical to GlobalPremiumAlert) ───────────────
type StatusBarStyle = 'dark-content' | 'light-content';
type ColorPalette = {
  bg: string; card: string; border: string;
  textPrimary: string; textSecondary: string; textTertiary: string;
  accent: string; red: string; green: string; orange: string;
  pillBg: string; modalBg: string; statusBar: StatusBarStyle;
};

const lightC: ColorPalette = {
  bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
  textPrimary: '#000000', textSecondary: '#6B6B6B', textTertiary: '#AEAEB2',
  accent: '#000000', red: '#E11900', green: '#34C759', orange: '#FF9500',
  pillBg: '#F2F2F7', modalBg: 'rgba(0,0,0,0.4)', statusBar: 'dark-content',
};

const darkC: ColorPalette = {
  bg: '#000000', card: '#141414', border: '#2C2C2E',
  textPrimary: '#FFFFFF', textSecondary: '#8E8E93', textTertiary: '#636366',
  accent: '#FFFFFF', red: '#FF453A', green: '#30D158', orange: '#FFB340',
  pillBg: '#1C1C1E', modalBg: 'rgba(0,0,0,0.7)', statusBar: 'light-content',
};

// ── Props ──────────────────────────────────────────────────────────
interface OTAUpdateModalProps {
  visible: boolean;
  onRestart: () => void;
  onDismiss: () => void;
  runtimeVersion?: string | null;
}

/**
 * A premium bottom-sheet modal that prompts the user to restart the app
 * after an OTA update has been downloaded. Mirrors the exact same design
 * language as `GlobalPremiumAlert` (drag indicator, icon circle, rounded
 * pill buttons, dark/light palette, PanResponder swipe-to-dismiss).
 */
export default function OTAUpdateModal({
  visible,
  onRestart,
  onDismiss,
  runtimeVersion,
}: OTAUpdateModalProps) {
  const { isDarkMode } = useAppTheme();
  const c = isDarkMode ? darkC : lightC;
  const insets = useSafeAreaInsets();

  // ── Swipe-to-dismiss (same logic as GlobalPremiumAlert) ──────────
  const panY = useRef(new Animated.Value(0)).current;

  const resetPositionAnim = Animated.spring(panY, {
    toValue: 0,
    useNativeDriver: true,
    bounciness: 0,
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 5 && Math.abs(gs.dx) < 30,
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        gs.dy > 5 && Math.abs(gs.dx) < 30,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) panY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60 || gs.vy > 0.5) {
          handleDismiss();
        } else {
          resetPositionAnim.start();
        }
      },
    }),
  ).current;

  const handleDismiss = () => {
    onDismiss();
    // Reset pan for next appearance
    setTimeout(() => panY.setValue(0), 300);
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={() => {
          /* non-cancelable: backdrop tap does nothing */
        }}
        dismissable={false}
        contentContainerStyle={[
          styles.modalContainer,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            paddingBottom: Math.max(insets.bottom + 20, 20),
          },
        ]}
        style={styles.modalOverlay}
      >
        <Animated.View
          style={{ transform: [{ translateY: panY }] }}
          {...panResponder.panHandlers}
        >
          {/* ── Drag indicator ─────────────────────────────────── */}
          <View style={styles.dragIndicator} />

          <View style={styles.content}>
            {/* ── Icon circle ────────────────────────────────── */}
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: c.accent + '15' },
              ]}
            >
              <MaterialCommunityIcons
                name="cellphone-arrow-down"
                size={32}
                color={c.accent}
              />
            </View>

            {/* ── Title ──────────────────────────────────────── */}
            <Text style={[styles.title, { color: c.textPrimary }]}>
              Update Ready
            </Text>

            {/* ── Subtitle ───────────────────────────────────── */}
            <Text style={[styles.description, { color: c.textSecondary }]}>
              A newer version has been downloaded and is ready to install.
            </Text>

            {/* ── Version pill ────────────────────────────────── */}
            {runtimeVersion ? (
              <View
                style={[
                  styles.versionPill,
                  { backgroundColor: c.pillBg, borderColor: c.border },
                ]}
              >
                <Text style={[styles.versionText, { color: c.textTertiary }]}>
                  v{runtimeVersion}
                </Text>
              </View>
            ) : null}

            {/* ── Buttons ────────────────────────────────────── */}
            <View style={styles.buttonContainer}>
              {/* Later (secondary) */}
              <TouchableOpacity
                style={[
                  styles.button,
                  {
                    backgroundColor: c.pillBg,
                    borderWidth: 1,
                    borderColor: c.border,
                  },
                ]}
                onPress={handleDismiss}
                activeOpacity={0.7}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.buttonText, { color: c.textPrimary }]}
                >
                  Later
                </Text>
              </TouchableOpacity>

              {/* Restart Now (primary) */}
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.accent },
                ]}
                onPress={onRestart}
                activeOpacity={0.7}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    styles.buttonText,
                    { color: isDarkMode ? '#000000' : '#FFFFFF' },
                  ]}
                >
                  Restart Now
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Modal>
    </Portal>
  );
}

// ── Styles (mirrors GlobalPremiumAlert 1:1) ────────────────────────
const styles = StyleSheet.create({
  modalOverlay: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  modalContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    marginHorizontal: 0,
  },
  dragIndicator: {
    width: 40,
    height: 5,
    backgroundColor: '#D1D1D6',
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  versionPill: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 28,
  },
  versionText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.3,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    flexWrap: 'wrap',
  },
  button: {
    flex: 1,
    minWidth: '45%',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
