import React, { createContext, useContext, ReactNode } from 'react';
import { getAuthToken, notifyUnauthorized } from './lib/authToken';

interface AuthContextType {
  isAuthenticated: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const value: AuthContextType = {
    isAuthenticated: Boolean(getAuthToken()),
    signOut: () => notifyUnauthorized(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthProvider;