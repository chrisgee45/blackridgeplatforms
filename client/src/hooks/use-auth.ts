import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
}

interface LoginResult {
  success?: boolean;
  mfaRequired?: boolean;
}

async function fetchUser(): Promise<AdminUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<AdminUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 0,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password, totpCode }: { username: string; password: string; totpCode?: string }): Promise<LoginResult> => {
      const res = await apiRequest("POST", "/api/admin/login", { username, password, totpCode });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout", {});
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    loginData: loginMutation.data,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
    resetLogin: loginMutation.reset,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
