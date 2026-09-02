import { forwardRef } from 'react';
import { TextInput as RNTextInput, type TextInputProps } from 'react-native';
import { fonts } from '../theme';

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} style={[{ fontFamily: fonts.regular }, style]} {...props} />;
});
