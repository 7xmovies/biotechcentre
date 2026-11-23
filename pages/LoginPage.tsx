import React from 'react';
import { Navigate } from 'react-router-dom';

const LoginPage: React.FC = () => {
  return <Navigate to="/dashboard" replace />;
};

export default LoginPage;