package dev.jagra.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jagra.sample.ui.ItemDetailScreen
import dev.jagra.sample.ui.ItemListScreen
import dev.jagra.sample.ui.LoginScreen
import dev.jagra.sample.ui.theme.SampleTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SampleTheme {
                SampleApp()
            }
        }
    }
}

@Composable
private fun SampleApp(model: StockViewModel = viewModel()) {
    val openItem = model.openItemId?.let { id -> model.stock.items.find { it.id == id } }
    when {
        !model.signedIn -> LoginScreen(onSignIn = model::signIn)
        openItem != null -> {
            BackHandler(onBack = model::close)
            ItemDetailScreen(
                item = openItem,
                saveState = model.saveState,
                onEdit = model::edited,
                onSave = model::save,
                onBack = model::close,
            )
        }
        else -> ItemListScreen(stock = model.stock, onOpen = model::open)
    }
}
