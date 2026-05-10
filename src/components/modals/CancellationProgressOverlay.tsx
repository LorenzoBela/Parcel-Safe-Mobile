/**
 * EC-32: Cancellation Progress Overlay
 * 
 * Shows real-time progress during booking cancellation.
 * Displays each step with smooth animations and reassuring messaging.
 * 
 * Design Philosophy: Minimalist elegance with industrial clarity.
 * Uses geometric precision and strategic motion to build confidence.
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Animated, Dimensions, Modal } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type CancellationStep = 'VALIDATING' | 'REVOKING_OTP' | 'GENERATING_RETURN_OTP' | 'UPDATING_DATABASE' | 'CONFIRMING_STATUS' | 'COMPLETE' | 'ERROR';

interface StepInfo {
  key: CancellationStep;
  label: string;
  icon: string;
  duration: number; // ms
}

const STEPS: StepInfo[] = [
  { key: 'VALIDATING', label: 'Validating request', icon: 'clipboard-check', duration: 400 },
  { key: 'REVOKING_OTP', label: 'Revoking access', icon: 'lock-off', duration: 500 },
  { key: 'GENERATING_RETURN_OTP', label: 'Generating return code', icon: 'key-plus', duration: 600 },
  { key: 'UPDATING_DATABASE', label: 'Updating records', icon: 'database-sync', duration: 800 },
  { key: 'CONFIRMING_STATUS', label: 'Confirming cancellation', icon: 'check-circle', duration: 500 },
];

interface CancellationProgressOverlayProps {
  visible: boolean;
  deliveryId: string;
  currentStep: CancellationStep;
  error?: string | null;
}

export default function CancellationProgressOverlay({
  visible,
  deliveryId,
  currentStep,
  error,
}: CancellationProgressOverlayProps) {
  const theme = useTheme();
  const [progressAnim] = useState(new Animated.Value(0));
  const [stepAnimations, setStepAnimations] = useState<Record<string, Animated.Value>>({});

  // Minimalist monochromatic color palette
  const uiColors = {
    accent: theme.dark ? '#F5F5F5' : '#111111',
    accentInverse: theme.dark ? '#111111' : '#FFFFFF',
    secondaryText: theme.dark ? '#A7A7A7' : '#616161',
    mutedIcon: theme.dark ? '#989898' : '#686868',
    divider: theme.dark ? '#343434' : '#D9D9D9',
    overlay: theme.dark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
    errorBox: theme.dark ? '#2A1F1F' : '#F5E5E5',
  };

  // Initialize step animations
  useEffect(() => {
    const newAnimations: Record<string, Animated.Value> = {};
    STEPS.forEach(step => {
      newAnimations[step.key] = new Animated.Value(0);
    });
    setStepAnimations(newAnimations);
  }, []);

  // Animate progress based on current step
  useEffect(() => {
    const stepIndex = STEPS.findIndex(s => s.key === currentStep);
    if (stepIndex >= 0 && Object.keys(stepAnimations).length > 0) {
      const targetProgress = ((stepIndex + 1) / STEPS.length);
      
      Animated.timing(progressAnim, {
        toValue: targetProgress,
        duration: 400,
        useNativeDriver: false,
      }).start();

      // Animate individual step
      const stepAnim = stepAnimations[currentStep];
      if (stepAnim) {
        Animated.timing(stepAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }).start();
      }
    }
  }, [currentStep, progressAnim, stepAnimations]);

  const screenWidth = Dimensions.get('window').width;
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const isComplete = currentStep === 'COMPLETE';
  const isError = currentStep === 'ERROR' || !!error;

  return (
    <Modal
      visible={visible && !isComplete}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={[styles.container, { backgroundColor: uiColors.overlay }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: uiColors.accent }]}>
              {isError ? 'Cancellation Error' : 'Cancelling Booking'}
            </Text>
            <Text style={[styles.bookingId, { color: uiColors.secondaryText }]}>
              {deliveryId}
            </Text>
          </View>

          {/* Progress Bar */}
          {!isError && (
            <View style={styles.progressContainer}>
              <View style={[styles.progressTrack, { backgroundColor: uiColors.divider }]}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: uiColors.accent,
                      width: progressWidth,
                    },
                  ]}
                />
              </View>
              <Text
                style={[styles.progressLabel, { color: uiColors.secondaryText }]}
              >
                {Math.round(
                  (STEPS.findIndex(s => s.key === currentStep) + 1) / STEPS.length * 100
                )}%
              </Text>
            </View>
          )}

          {/* Steps Timeline */}
          <View style={styles.stepsContainer}>
            {STEPS.map((step, index) => {
              const stepAnim = stepAnimations[step.key];
              const isActive = step.key === currentStep;
              const isPassed = STEPS.findIndex(s => s.key === currentStep) >= index;
              const isError_ = isError && isActive;

              const iconScale = stepAnim?.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1.1],
              });

              return (
                <View key={step.key}>
                  {/* Connector Line */}
                  {index < STEPS.length - 1 && (
                    <View
                      style={[
                        styles.connector,
                        {
                          backgroundColor: isPassed
                            ? uiColors.accent
                            : uiColors.divider,
                        },
                      ]}
                    />
                  )}

                  {/* Step Dot & Label */}
                  <View style={styles.stepRow}>
                    <Animated.View
                      style={[
                        styles.stepDot,
                        {
                          backgroundColor: isError_
                            ? '#DC3545'
                            : isPassed
                            ? uiColors.accent
                            : uiColors.divider,
                          transform: [{ scale: iconScale }],
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={isError_ ? 'alert-circle' : step.icon}
                        size={16}
                        color={isError_ || isPassed ? uiColors.accentInverse : uiColors.mutedIcon}
                      />
                    </Animated.View>

                    <View style={styles.stepLabel}>
                      <Text
                        style={[
                          styles.stepText,
                          {
                            color: isActive
                              ? uiColors.accent
                              : isPassed
                              ? uiColors.accent
                              : uiColors.secondaryText,
                            fontWeight: isActive ? '600' : '400',
                          },
                        ]}
                      >
                        {step.label}
                      </Text>
                      {isActive && !isPassed && (
                        <View style={styles.loadingDots}>
                          <Text style={{ color: uiColors.accent, fontSize: 10 }}>● ● ●</Text>
                        </View>
                      )}
                      {isPassed && !isActive && (
                        <MaterialCommunityIcons
                          name="check"
                          size={14}
                          color={uiColors.accent}
                        />
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Error Message */}
          {isError && error && (
            <View style={[styles.errorBox, { backgroundColor: uiColors.errorBox }]}>
              <MaterialCommunityIcons
                name="alert-circle"
                size={20}
                color="#DC3545"
              />
              <Text style={[styles.errorText, { color: '#DC3545' }]}>
                {error}
              </Text>
            </View>
          )}

          {/* Status Message */}
          <View style={[styles.messageBox, { borderTopColor: uiColors.divider }]}>
            <Text style={[styles.message, { color: uiColors.secondaryText }]}>
              {isError
                ? 'Please check your connection and try again.'
                : 'Please keep this screen open while we process your cancellation.'}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  bookingId: {
    fontSize: 12,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    letterSpacing: 0.3,
  },
  stepsContainer: {
    marginBottom: 20,
  },
  connector: {
    height: 20,
    width: 2,
    marginLeft: 15,
    marginVertical: 0,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepText: {
    fontSize: 13,
    flex: 1,
  },
  loadingDots: {
    marginLeft: 8,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  messageBox: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
