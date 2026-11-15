package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
internal fun AccountSettingsScreen(api: FreeTalkApi, cache: MediaCache, user: SignedInUser, devices: List<AccountDevice>,
    onBack: () -> Unit, onUser: (SignedInUser) -> Unit, onLogout: () -> Unit, appearance: NativeAppearance? = null,
    preview: Boolean = false, initialTab: String? = null) {
    NativeSettingsScreen(api, cache, user, onBack, onUser, onLogout, preview, initialTab)
}

@Composable
internal fun SettingsItem(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), color = MobileDesign.incoming,
        shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
        Row(Modifier.heightIn(min = 66.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            WebIcon(icon, null, Modifier.size(20.dp), tint = MobileDesign.accent)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MobileText(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            WebIcon(WebIcons.ChevronRight, null, Modifier.size(18.dp), tint = MobileDesign.muted)
        }
    }
}

@Composable
internal fun ProfileIdentity(user: SignedInUser) {
    Column(Modifier.fillMaxWidth().background(MobileDesign.incoming, RoundedCornerShape(18.dp)), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth().height(110.dp).background(MobileDesign.gradient, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))) {
            if (user.coverUrl != null) AsyncImage(user.coverUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MobileAvatar(user.displayName, user.avatarUrl, 64.dp)
            MobileText(user.displayName, localize = false, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            MobileText("@${user.username}", color = MobileDesign.muted, fontSize = 12.sp)
            if (user.bio.isNotBlank()) MobileText(user.bio, localize = false, fontSize = 14.sp)
        }
    }
}
