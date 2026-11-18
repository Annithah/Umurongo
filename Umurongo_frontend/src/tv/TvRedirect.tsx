import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Spinner } from '../components/ui';

/** /tv opens the hospital's TV page. Pilot 1 has one hospital. */
export default function TvRedirect() {
  const { data, isError } = useQuery({ queryKey: ['hospitals'], queryFn: api.hospitals });
  if (isError) return <p className="p-10 text-center text-xl text-muted">Cannot reach the server. Retrying...</p>;
  if (!data) return <Spinner />;
  if (!data.length) return <p className="p-10 text-center text-xl text-muted">No hospital is set up yet.</p>;
  return <Navigate to={`/tv/${data[0].id}`} replace />;
}
