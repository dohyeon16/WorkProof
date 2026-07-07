import { TextInput as RNTextInput, type TextInputProps } from 'react-native';
import { fonts } from '../theme';

export function TextInput({ style, ...props }: TextInputProps) {
  return <RNTextInput style={[{ fontFamily: fonts.regular }, style]} {...props} />;
}
