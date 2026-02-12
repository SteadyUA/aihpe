import React, { createContext, useContext } from 'react';

interface ConnectionContextType {
    isConnected: boolean;
}

const ConnectionContext = createContext<ConnectionContextType>({ isConnected: false });

export const useConnection = () => useContext(ConnectionContext);

interface ConnectionProviderProps {
    isConnected: boolean;
    children: React.ReactNode;
}

export const ConnectionProvider: React.FC<ConnectionProviderProps> = ({ isConnected, children }) => {
    return (
        <ConnectionContext.Provider value={{ isConnected }}>
            {children}
        </ConnectionContext.Provider>
    );
};
