import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';
import { registerGlobals } from '@livekit/react-native';
import App from './App';

registerGlobals();
registerRootComponent(App);
