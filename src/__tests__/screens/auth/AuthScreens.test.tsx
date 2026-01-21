import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import DevRoleSelectionScreen from '../../../screens/auth/DevRoleSelectionScreen';
import LoginScreen from '../../../screens/auth/LoginScreen';
import OTPScreen from '../../../screens/auth/OTPScreen';
import RegisterScreen from '../../../screens/auth/RegisterScreen';
import RoleSelectionScreen from '../../../screens/auth/RoleSelectionScreen';

const mockNavigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
};
const mockRoute = { params: {} } as any;

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => mockNavigation,
    useRoute: () => mockRoute,
    useFocusEffect: (callback: any) => callback(),
}));

jest.mock('../../../services/auth', () => ({
    signInWithGoogleAndSyncProfile: jest.fn(() => Promise.resolve({
        email: 'test@example.com',
        role: 'customer',
    })),
    isGoogleSignInAvailable: jest.fn(() => true),
}));

jest.mock('../../../store/authStore', () => {
    const store = {
        user: { name: 'Test User', photo: null },
        isAuthenticated: true,
        role: 'admin',
        login: jest.fn(),
        logout: jest.fn(),
    };
    return {
        __esModule: true,
        default: (selector?: any) => (selector ? selector(store) : store),
    };
});

jest.mock('../../../services/firebaseClient', () => ({
    subscribeToDisplay: jest.fn(() => () => undefined),
    subscribeToBoxState: jest.fn(() => () => undefined),
}));

jest.mock('react-native-paper', () => {
    const Paper = jest.requireActual('react-native-paper');
    return {
        ...Paper,
        Avatar: {
            ...Paper.Avatar,
            Icon: (props) => <Paper.Text>{props.icon}</Paper.Text>,
        },
    };
});

const renderWithProvider = (component: React.ReactElement) =>
    render(<PaperProvider>{component}</PaperProvider>);

describe('Auth Screens', () => {
    // Increase timeout for slow imports
    jest.setTimeout(30000);

    beforeEach(() => {
        jest.clearAllMocks();
        mockRoute.params = {};
    });

    afterEach(() => {
        // jest.useRealTimers();
    });

    it('renders LoginScreen', () => {
        const { getByText } = renderWithProvider(<LoginScreen />);
        expect(getByText('Parcel Safe')).toBeTruthy();
        expect(getByText('Continue with Google')).toBeTruthy();
    });

    it('renders RegisterScreen', () => {
        const { getByText } = renderWithProvider(<RegisterScreen />);
        expect(getByText('Join Parcel-Safe')).toBeTruthy();
    });

    it('renders RoleSelectionScreen', () => {
        const { getByText } = renderWithProvider(<RoleSelectionScreen />);
        expect(getByText(/Choose dashboard/i)).toBeTruthy();
    });

    it('renders DevRoleSelectionScreen', () => {
        const { getByText } = renderWithProvider(<DevRoleSelectionScreen />);
        expect(getByText('Dev Mode')).toBeTruthy();
    });

    it('renders OTPScreen', () => {
        mockRoute.params = { boxId: 'BOX-1' };
        const { getByText } = renderWithProvider(<OTPScreen />);
        expect(getByText('Secure Delivery Code')).toBeTruthy();
    });
});
