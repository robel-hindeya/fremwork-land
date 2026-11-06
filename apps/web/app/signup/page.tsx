import type { Metadata } from 'next';
import { SignupScreen } from '@/components/screens/SignupScreen';

export const metadata: Metadata = {
  title: 'Sign Up',
  description:
    'Create your Fremwork account. The AI finance team in one chat: Analyst, Accountant, Controller, and automated insights.',
  openGraph: {
    title: 'Sign Up · Fremwork',
    description:
      'Create your Fremwork account. The AI finance team in one chat: Analyst, Accountant, Controller, and automated insights.',
    url: 'https://www.fremwork.com/signup',
  },
};

export default function SignupPage() {
  return <SignupScreen />;
}
