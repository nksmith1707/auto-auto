// Where each application step lives in the app.
export const STEP_ROUTES = {
  area: "/service-area", services: "/services", business: "/onboarding/business", identity: "/onboarding/identity", background: "/onboarding/background",
  insurance: "/onboarding/insurance", skills: "/onboarding/skills", safety: "/onboarding/safety", payouts: "/payouts", agreements: "/onboarding/agreements",
};
export const stepRoute = (id) => STEP_ROUTES[id] || "/home";
