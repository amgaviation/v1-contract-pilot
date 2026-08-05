/**
=========================================================
* Material Dashboard 3 PRO React - v2.4.0
=========================================================

* Product Page: https://www.creative-tim.com/product/material-dashboard-pro-react
* Copyright 2024 Creative Tim (https://www.creative-tim.com)

Coded by www.creative-tim.com

 =========================================================

* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
*/

// @mui material components
import { createTheme } from "@mui/material/styles";

// Material Dashboard 3 PRO React base styles
import colors from "@/lib/mdpro/theme/base/colors";
import breakpoints from "@/lib/mdpro/theme/base/breakpoints";
import typography from "@/lib/mdpro/theme/base/typography";
import boxShadows from "@/lib/mdpro/theme/base/boxShadows";
import borders from "@/lib/mdpro/theme/base/borders";
import globals from "@/lib/mdpro/theme/base/globals";

// Material Dashboard 3 PRO React helper functions
import boxShadow from "@/lib/mdpro/theme/functions/boxShadow";
import hexToRgb from "@/lib/mdpro/theme/functions/hexToRgb";
import linearGradient from "@/lib/mdpro/theme/functions/linearGradient";
import pxToRem from "@/lib/mdpro/theme/functions/pxToRem";
import rgba from "@/lib/mdpro/theme/functions/rgba";

// Material Dashboard 3 PRO React components base styles for @mui material components
import sidenav from "@/lib/mdpro/theme/components/sidenav";
import list from "@/lib/mdpro/theme/components/list";
import listItem from "@/lib/mdpro/theme/components/list/listItem";
import listItemText from "@/lib/mdpro/theme/components/list/listItemText";
import card from "@/lib/mdpro/theme/components/card";
import cardMedia from "@/lib/mdpro/theme/components/card/cardMedia";
import cardContent from "@/lib/mdpro/theme/components/card/cardContent";
import button from "@/lib/mdpro/theme/components/button";
import iconButton from "@/lib/mdpro/theme/components/iconButton";
import input from "@/lib/mdpro/theme/components/form/input";
import inputLabel from "@/lib/mdpro/theme/components/form/inputLabel";
import inputOutlined from "@/lib/mdpro/theme/components/form/inputOutlined";
import textField from "@/lib/mdpro/theme/components/form/textField";
import menu from "@/lib/mdpro/theme/components/menu";
import menuItem from "@/lib/mdpro/theme/components/menu/menuItem";
import switchButton from "@/lib/mdpro/theme/components/form/switchButton";
import divider from "@/lib/mdpro/theme/components/divider";
import tableContainer from "@/lib/mdpro/theme/components/table/tableContainer";
import tableHead from "@/lib/mdpro/theme/components/table/tableHead";
import tableCell from "@/lib/mdpro/theme/components/table/tableCell";
import linearProgress from "@/lib/mdpro/theme/components/linearProgress";
import breadcrumbs from "@/lib/mdpro/theme/components/breadcrumbs";
import slider from "@/lib/mdpro/theme/components/slider";
import avatar from "@/lib/mdpro/theme/components/avatar";
import tooltip from "@/lib/mdpro/theme/components/tooltip";
import appBar from "@/lib/mdpro/theme/components/appBar";
import tabs from "@/lib/mdpro/theme/components/tabs";
import tab from "@/lib/mdpro/theme/components/tabs/tab";
import stepper from "@/lib/mdpro/theme/components/stepper";
import step from "@/lib/mdpro/theme/components/stepper/step";
import stepConnector from "@/lib/mdpro/theme/components/stepper/stepConnector";
import stepLabel from "@/lib/mdpro/theme/components/stepper/stepLabel";
import stepIcon from "@/lib/mdpro/theme/components/stepper/stepIcon";
import select from "@/lib/mdpro/theme/components/form/select";
import formControlLabel from "@/lib/mdpro/theme/components/form/formControlLabel";
import formLabel from "@/lib/mdpro/theme/components/form/formLabel";
import checkbox from "@/lib/mdpro/theme/components/form/checkbox";
import radio from "@/lib/mdpro/theme/components/form/radio";
import autocomplete from "@/lib/mdpro/theme/components/form/autocomplete";
import flatpickr from "@/lib/mdpro/theme/components/flatpickr";
import container from "@/lib/mdpro/theme/components/container";
import popover from "@/lib/mdpro/theme/components/popover";
import buttonBase from "@/lib/mdpro/theme/components/buttonBase";
import icon from "@/lib/mdpro/theme/components/icon";
import svgIcon from "@/lib/mdpro/theme/components/svgIcon";
import link from "@/lib/mdpro/theme/components/link";
import dialog from "@/lib/mdpro/theme/components/dialog";
import dialogTitle from "@/lib/mdpro/theme/components/dialog/dialogTitle";
import dialogContent from "@/lib/mdpro/theme/components/dialog/dialogContent";
import dialogContentText from "@/lib/mdpro/theme/components/dialog/dialogContentText";
import dialogActions from "@/lib/mdpro/theme/components/dialog/dialogActions";

export default createTheme({
  breakpoints: { ...breakpoints },
  palette: { ...colors },
  typography: { ...typography },
  boxShadows: { ...boxShadows },
  borders: { ...borders },
  functions: {
    boxShadow,
    hexToRgb,
    linearGradient,
    pxToRem,
    rgba,
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ...globals,
        ...flatpickr,
        ...container,
      },
    },
    MuiDrawer: { ...sidenav },
    MuiList: { ...list },
    MuiListItem: { ...listItem },
    MuiListItemText: { ...listItemText },
    MuiCard: { ...card },
    MuiCardMedia: { ...cardMedia },
    MuiCardContent: { ...cardContent },
    MuiButton: { ...button },
    MuiIconButton: { ...iconButton },
    MuiInput: { ...input },
    MuiInputLabel: { ...inputLabel },
    MuiOutlinedInput: { ...inputOutlined },
    MuiTextField: { ...textField },
    MuiMenu: { ...menu },
    MuiMenuItem: { ...menuItem },
    MuiSwitch: { ...switchButton },
    MuiDivider: { ...divider },
    MuiTableContainer: { ...tableContainer },
    MuiTableHead: { ...tableHead },
    MuiTableCell: { ...tableCell },
    MuiLinearProgress: { ...linearProgress },
    MuiBreadcrumbs: { ...breadcrumbs },
    MuiSlider: { ...slider },
    MuiAvatar: { ...avatar },
    MuiTooltip: { ...tooltip },
    MuiAppBar: { ...appBar },
    MuiTabs: { ...tabs },
    MuiTab: { ...tab },
    MuiStepper: { ...stepper },
    MuiStep: { ...step },
    MuiStepConnector: { ...stepConnector },
    MuiStepLabel: { ...stepLabel },
    MuiStepIcon: { ...stepIcon },
    MuiSelect: { ...select },
    MuiFormControlLabel: { ...formControlLabel },
    MuiFormLabel: { ...formLabel },
    MuiCheckbox: { ...checkbox },
    MuiRadio: { ...radio },
    MuiAutocomplete: { ...autocomplete },
    MuiPopover: { ...popover },
    MuiButtonBase: { ...buttonBase },
    MuiIcon: { ...icon },
    MuiSvgIcon: { ...svgIcon },
    MuiLink: { ...link },
    MuiDialog: { ...dialog },
    MuiDialogTitle: { ...dialogTitle },
    MuiDialogContent: { ...dialogContent },
    MuiDialogContentText: { ...dialogContentText },
    MuiDialogActions: { ...dialogActions },
  },
});
