import { Text, View } from "react-native";
import { fonts, p } from "../theme";

export function PartnerBadge({ small }) {
  return (
    <View style={{ borderWidth: 1.5, borderColor: p.money, borderRadius: 6, paddingVertical: small ? 4 : 6, paddingLeft: small ? 10 : 14, paddingRight: small ? 6 : 10, alignSelf: small ? "flex-start" : "center" }}>
      <Text style={{ fontFamily: fonts.displayX, letterSpacing: small ? 3.5 : 4.2, fontSize: small ? 11 : 13, color: p.money }}>PARTNER</Text>
    </View>
  );
}
