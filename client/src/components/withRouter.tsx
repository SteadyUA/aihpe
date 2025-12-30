import React from 'react';
import {
    useLocation,
    useNavigate,
    useParams,
    useSearchParams,
} from 'react-router-dom';

export interface RouterProps {
    router: {
        location: ReturnType<typeof useLocation>;
        navigate: ReturnType<typeof useNavigate>;
        params: ReturnType<typeof useParams>;
        searchParams: URLSearchParams;
        setSearchParams: ReturnType<typeof useSearchParams>[1];
    };
}

export function withRouter<P extends RouterProps>(
    Component: React.ComponentType<P>,
) {
    return function ComponentWithRouterProp(props: Omit<P, keyof RouterProps>) {
        const location = useLocation();
        const navigate = useNavigate();
        const params = useParams();
        const [searchParams, setSearchParams] = useSearchParams();

        return (
            <Component
                {...props as P}
                router={{ location, navigate, params, searchParams, setSearchParams }}
            />
        );
    };
}
