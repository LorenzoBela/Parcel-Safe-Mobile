import React, { useMemo, useRef, useState } from 'react';
import {
    Animated,
    LayoutChangeEvent,
    PanResponder,
    PanResponderGestureState,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface SwipeConfirmButtonProps {
    label: string;
    onConfirm: () => void;
    disabled?: boolean;
}

const KNOB_SIZE = 44;
const PADDING = 4;

export default function SwipeConfirmButton({ label, onConfirm, disabled = false }: SwipeConfirmButtonProps) {
    const translateX = useRef(new Animated.Value(0)).current;
    const [containerWidth, setContainerWidth] = useState(280);
    const maxTranslate = Math.max(0, containerWidth - KNOB_SIZE - PADDING * 2);

    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_, gestureState) => !disabled && Math.abs(gestureState.dx) > 4,
                onPanResponderMove: (_, gestureState) => {
                    const clamped = Math.max(0, Math.min(maxTranslate, gestureState.dx));
                    translateX.setValue(clamped);
                },
                onPanResponderRelease: (_, gestureState) => {
                    handleRelease(gestureState);
                },
                onPanResponderTerminate: (_, gestureState) => {
                    handleRelease(gestureState);
                },
            }),
        [disabled, maxTranslate, translateX]
    );

    const handleRelease = (gestureState: PanResponderGestureState) => {
        if (disabled) {
            Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 0,
            }).start();
            return;
        }

        const shouldConfirm = gestureState.dx >= maxTranslate * 0.85;

        if (shouldConfirm) {
            Animated.timing(translateX, {
                toValue: maxTranslate,
                duration: 120,
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) {
                    onConfirm();
                }
                translateX.setValue(0);
            });
            return;
        }

        Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
        }).start();
    };

    const onLayout = (event: LayoutChangeEvent) => {
        setContainerWidth(event.nativeEvent.layout.width);
    };

    return (
        <View style={[styles.container, disabled && styles.containerDisabled]} onLayout={onLayout}>
            <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
            <Animated.View
                style={[styles.knob, { transform: [{ translateX }] }, disabled && styles.knobDisabled]}
                {...panResponder.panHandlers}
            >
                <Text style={styles.knobIcon}>➜</Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 52,
        borderRadius: 26,
        backgroundColor: '#111827',
        justifyContent: 'center',
        overflow: 'hidden',
        paddingHorizontal: PADDING,
    },
    containerDisabled: {
        backgroundColor: '#9ca3af',
    },
    label: {
        color: '#ffffff',
        textAlign: 'center',
        fontFamily: 'Inter_700Bold',
        letterSpacing: 0.3,
    },
    labelDisabled: {
        color: '#f3f4f6',
    },
    knob: {
        position: 'absolute',
        left: PADDING,
        width: KNOB_SIZE,
        height: KNOB_SIZE,
        borderRadius: KNOB_SIZE / 2,
        backgroundColor: '#22c55e',
        alignItems: 'center',
        justifyContent: 'center',
    },
    knobDisabled: {
        backgroundColor: '#d1d5db',
    },
    knobIcon: {
        color: '#ffffff',
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
    },
});
